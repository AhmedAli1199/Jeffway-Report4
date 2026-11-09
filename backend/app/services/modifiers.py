"""
Modifier letters and numbers on electrical symbols (HL, USB, IP, 2, 3, R ...).

UK legends often draw variants of one glyph that differ only by a short code printed beside it:
a flex outlet vs the same outlet marked "HL" (high level), a double socket vs "USB", a switch vs
"2" (2-way) or "3" (intermediate). The PDFs come straight from CAD, so those codes are real text
we can read with their positions.

For each sheet we learn, from its own legend, which code belongs to which item, then check every
mark: a code printed beside a mark that its own symbol doesn't carry means it's a different item.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import fitz

from app.services.sheet_classifier import _STOP
from app.services.master_excel_service import MasterExcelService

CODE = re.compile(r"^(?:[A-Z]{1,4}|[0-9])$")
NOT_CODES = {"A", "TO", "BE", "OR", "OF", "IN", "ON", "AT", "BY", "NO", "THE", "AND", "FOR", "MM", "DO", "NOT", "REV", "SEE", "ALL"}


@lru_cache(maxsize=64)
def sheet_words(pdf: str, page_index: int, dpi: int = 200) -> Tuple[Tuple[float, float, float, float, str, int, int], ...]:
    """Words in rendered-image pixels (rotation applied): (x0, y0, x1, y1, text, block, line)."""
    k = dpi / 72.0
    out = []
    with fitz.open(pdf) as doc:
        page = doc[page_index]
        rot = page.rotation_matrix
        for x0, y0, x1, y1, w, b, l, _ in page.get_text("words"):
            r = fitz.Rect(x0, y0, x1, y1) * rot
            out.append((r.x0 * k, r.y0 * k, r.x1 * k, r.y1 * k, w, b, l))
    return tuple(out)


def _is_code(w: str) -> bool:
    return bool(CODE.match(w)) and w not in NOT_CODES


def tokens(s: str) -> set:
    """Words for comparing descriptions. Unlike the sheet classifier, single digits are kept:
    "1 gang 2 way switch" and "1 gang 3 way switch" must differ."""
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in _STOP and (len(w) > 1 or w.isdigit())}


@lru_cache(maxsize=1)
def _library_tokens() -> tuple:
    out = []
    for s in MasterExcelService.load_symbol_library():
        for text in (s.get("label"), s.get("cad_label")):
            t = tokens(text or "")
            if len(t) >= 2:
                out.append((s.get("legend_id") or s.get("symbol_id"), frozenset(t)))
    return tuple(out)


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def legend_modifiers(words) -> Dict[str, Any]:
    """Read this sheet's legend rows and the codes beside them.

    Returns {"codes": {code: description}, "by_symbol": {library_id: {codes}},
             "rows": {library_id: description}, "row_codes": {description: {codes}}}"""
    lib = _library_tokens()
    lib_by_id: Dict[str, List[frozenset]] = {}
    for sid, st in lib:
        lib_by_id.setdefault(sid, []).append(st)

    def best_lib(t: set) -> float:
        return max((_jaccard(t, st) for _, st in lib), default=0.0)

    blocks: Dict[int, Dict[int, List]] = {}
    for w in words:
        blocks.setdefault(w[5], {}).setdefault(w[6], []).append(w)

    # Rows: a block is one item, unless several of its lines are each a legend item (e.g. 1/2/3-way switches)
    rows: List[Dict[str, Any]] = []
    for b, lines in blocks.items():
        line_rows = []
        for ln, ws in sorted(lines.items()):
            text = " ".join(w[4] for w in ws)
            # where the description starts: a letter printed inside the glyph (smoke "S") can sit in the same text block
            real = [w for w in ws if len(w[4]) >= 3]
            line_rows.append({"text": text, "tokens": tokens(text), "x0": min(w[0] for w in ws), "xd": min(w[0] for w in real) if real else None,
                              "y0": min(w[1] for w in ws), "y1": max(w[3] for w in ws)})
        whole = " ".join(r["text"] for r in line_rows)
        if len(whole) > 160 or len(tokens(whole)) < 2:
            continue
        separate = sum(1 for r in line_rows if best_lib(r["tokens"]) >= 0.75) >= 2
        if separate:
            for r in line_rows:
                if len(r["tokens"]) >= 2:
                    rows.append({**r, "spans": [(r["y0"], r["y1"])]})
        else:
            rows.append({
                "text": whole, "tokens": tokens(whole), "x0": min(r["x0"] for r in line_rows), "xd": min((r["xd"] for r in line_rows if r["xd"] is not None), default=min(r["x0"] for r in line_rows)),
                "y0": line_rows[0]["y0"], "y1": line_rows[-1]["y1"],
                "spans": [(r["y0"], r["y1"]) for r in line_rows],
            })
    if not rows:
        return {"codes": {}, "by_symbol": {}, "rows": {}, "row_codes": {}, "row_tokens": {}, "row_boxes": {}}

    # Each code to the nearest row to its right (by the closest line of that row)
    row_codes: Dict[int, Set[str]] = {}
    codes: Dict[str, str] = {}
    for w in words:
        if not _is_code(w[4]):
            continue
        wcy = (w[1] + w[3]) / 2
        best, best_d = None, 1e9
        for i, r in enumerate(rows):
            dx = r["x0"] - w[2]
            if dx < -2 or dx > 220:
                continue
            dy = min(0.0 if a - 4 <= wcy <= b + 4 else min(abs(wcy - a), abs(wcy - b)) for a, b in r["spans"])
            h = max(b - a for a, b in r["spans"])
            if dy <= max(10.0, 0.6 * h):
                d = dy * 3 + dx * 0.2
                if d < best_d:
                    best, best_d = i, d
        if best is not None:
            row_codes.setdefault(best, set()).add(w[4])
            codes.setdefault(w[4], rows[best]["text"])

    # Each library symbol's own row: the best-worded match on this sheet
    by_symbol: Dict[str, Set[str]] = {}
    row_of: Dict[str, str] = {}
    own_row: Dict[str, int] = {}
    for sid, sts in lib_by_id.items():
        score, i = max((max(_jaccard(r["tokens"], st) for st in sts), i) for i, r in enumerate(rows))
        if score >= 0.6:
            own_row[sid] = i
            row_of[sid] = rows[i]["text"]
            by_symbol[sid] = set(row_codes.get(i, set()))
    return {
        "codes": codes, "by_symbol": by_symbol, "rows": row_of,
        "row_codes": {rows[i]["text"]: c for i, c in row_codes.items()},
        "row_tokens": {r["text"]: r["tokens"] for r in rows},
        # where each symbol's legend row sits: its glyph is drawn just left of the text
        "row_boxes": {sid: (rows[i]["xd"] if rows[i]["xd"] is not None else rows[i]["x0"], rows[i]["y0"], rows[i]["y1"]) for sid, i in own_row.items()},
        # where the row's text starts (its first word, even "1" of "1 gang"): the legend picture stops there
        "row_text_x0": {sid: rows[i]["x0"] for sid, i in own_row.items()},
    }


def _fit(desc_tokens: set, legend_id: str) -> float:
    return max((_jaccard(desc_tokens, st) for sid, st in _library_tokens() if sid == legend_id), default=0.0)


def codes_near(words, m: Dict[str, Any], known: Set[str], owner: Optional[Dict[int, str]] = None) -> Set[str]:
    """Legend codes printed right beside a mark on the plan (and, if given, nearest to this mark)."""
    cx, cy = m["x"] + m["width"] / 2, m["y"] + m["height"] / 2
    r = 1.3 * max(m["width"], m["height"]) + 14
    out = set()
    for i, w in enumerate(words):
        if w[4] not in known:
            continue
        if owner is not None and owner.get(i) != m.get("marker_id"):
            continue
        wx, wy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        if abs(wx - cx) <= r and abs(wy - cy) <= r:
            out.add(w[4])
    return out


def nearest_owner(words, marks: List[Dict[str, Any]], known: Set[str], min_score: float = 0.65) -> Dict[int, str]:
    """Which mark each code on the plan belongs to: the closest confident one (weak matches often
    sit on the text itself and would otherwise steal it)."""
    owner: Dict[int, str] = {}
    centres = [(m["marker_id"], m["x"] + m["width"] / 2, m["y"] + m["height"] / 2) for m in marks if m["confidence_score"] >= min_score]
    for i, w in enumerate(words):
        if w[4] not in known or not centres:
            continue
        wx, wy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        owner[i] = min(centres, key=lambda c: (c[1] - wx) ** 2 + (c[2] - wy) ** 2)[0]
    return owner


def check(m: Dict[str, Any], words, mods: Dict[str, Any], owner: Optional[Dict[int, str]] = None) -> Optional[Dict[str, Any]]:
    """Compare the codes beside a mark with the codes its own legend row carries on this sheet."""
    known = set(mods["codes"])
    if not known or m["legend_id"] not in mods["by_symbol"]:
        return None  # this symbol's row isn't on this sheet's legend: nothing reliable to compare against
    own = mods["by_symbol"][m["legend_id"]]
    near = codes_near(words, m, known, owner)
    extra = near - own
    missing = own - near
    if not extra and not missing:
        return None
    note = []
    target = None
    # A code whose legend row fits this symbol as well as its own row does is a variant the library
    # deliberately covers (e.g. "Extract fan (ceiling or wall)" vs legend rows for each): not a conflict
    own_text = mods["rows"].get(m["legend_id"], "")
    own_fit = _fit(mods["row_tokens"].get(own_text, set()), m["legend_id"])
    extra = {c for c in extra if _fit(mods["row_tokens"].get(mods["codes"][c], set()), m["legend_id"]) < own_fit - 0.05}
    if not extra and not missing:
        return None
    if extra:
        c = sorted(extra)[0]
        note.append(f'"{c}" is printed beside it; on this sheet\'s legend "{c}" marks "{mods["codes"][c]}"')
        target = next((sid for sid, cs in mods["by_symbol"].items() if cs == {c} and sid != m["legend_id"]), None)
    if missing:
        note.append(f'its legend entry carries "{", ".join(sorted(missing))}", which isn\'t printed beside it')
    return {"extra": sorted(extra), "missing": sorted(missing), "near": sorted(near), "relabel_to": target, "note": "; ".join(note)}


def describe_for_ai(mods: Dict[str, Any], legend_id: str) -> str:
    """Prompt text: what the codes on this sheet mean and whether the target carries one."""
    if not mods["codes"]:
        return ""
    lines = [f'  "{c}" = {d}' for c, d in sorted(mods["codes"].items())]
    own = sorted(mods["by_symbol"].get(legend_id, set()))
    target = (f'The TARGET symbol is drawn WITH "{", ".join(own)}" on this legend.' if own
              else "The TARGET symbol is drawn with NO code letters/numbers beside it on this legend.")
    return "Codes printed beside symbols on THIS sheet's legend (read from the CAD file):\n" + "\n".join(lines) + "\n" + target


def legend_entry_box(mods: Dict[str, Any], sid: str) -> Optional[Dict[str, float]]:
    """Where a symbol's own entry (glyph + its code letters) sits in this sheet's legend, in image pixels:
    the review queue shows it as the reference picture, so it always carries the right code."""
    rb = (mods.get("row_boxes") or {}).get(sid)
    if not rb:
        return None
    xd, y0, y1 = rb
    tx = (mods.get("row_text_x0") or {}).get(sid, xd)
    right = tx if tx < xd and xd - tx < 60 else xd  # "1 gang …": stop before the "1"; a letter inside the glyph doesn't count
    h = max(12.0, y1 - y0)
    x0 = max(0.0, right - 4.2 * h)
    return {"x": round(x0, 1), "y": round(y0 - 0.15 * h, 1), "width": round(right - 3 - x0, 1), "height": round((y1 - y0) + 0.3 * h, 1)}


def apply_to_sheet(pdf: Path, page_index: int, marks: List[Dict[str, Any]], library_ids: Set[str],
                   only: Optional[List[Dict[str, Any]]] = None, relabel_only: bool = False) -> int:
    """First-pass check. A mark carrying another item's code is moved to that symbol if it's in the
    library; otherwise it's marked down so it isn't counted without a person looking. Returns changes."""
    try:
        words = sheet_words(str(pdf), page_index)
    except Exception:
        return 0
    mods = legend_modifiers(words)
    if not mods["codes"]:
        return 0
    changed = 0
    owner = nearest_owner(words, marks, set(mods["codes"]))
    targets = marks if only is None else only  # only: check just these (e.g. items added later), codes still go to the nearest of all marks
    for m in targets:
        res = check(m, words, mods, owner)
        if not res:
            continue
        if relabel_only and not (res["extra"] and res["relabel_to"] and res["relabel_to"] in library_ids and res["relabel_to"] != m["legend_id"]):
            continue
        meta = dict(m.get("metadata") or {})
        meta["modifier_check"] = res
        if res["extra"] and res["relabel_to"] and res["relabel_to"] in library_ids:
            meta["relabelled_from"] = m["legend_id"]
            box = legend_entry_box(mods, res["relabel_to"])
            if box:
                meta["legend_entry"] = box
            m["legend_id"] = res["relabel_to"]
            m["status"] = "needs_review"
        else:
            meta["first_pass_score_before_modifier"] = m["confidence_score"]
            m["confidence_score"] = round(max(0.0, m["confidence_score"] - (0.3 if res["extra"] else 0.2)), 3)
            m["status"] = "needs_review"
        m["metadata"] = meta
        changed += 1
    return changed


def confirm_by_code(pdf: Path, page_index: int, marks: List[Dict[str, Any]], auto_high: float, low: float = 0.55) -> int:
    """A weak mark with exactly its own legend code printed beside it (BA, CL, R, 2, 3 ...) is that item:
    the code is CAD text, not a picture, so it doesn't depend on the image score. Returns marks confirmed."""
    try:
        words = sheet_words(str(pdf), page_index)
    except Exception:
        return 0
    mods = legend_modifiers(words)
    known = set(mods["codes"])
    if not known:
        return 0
    n = 0
    for m in marks:
        own = mods["by_symbol"].get(m["legend_id"])
        if not own or not (low <= m["confidence_score"] < auto_high) or m.get("status") == "possible_missed":
            continue
        if (m.get("metadata") or {}).get("modifier_check", {}).get("extra"):
            continue
        near = codes_near(words, m, known)
        if own <= near and not (near - own):
            meta = dict(m.get("metadata") or {})
            meta["first_pass_score_before_code"] = m["confidence_score"]
            meta["code_confirmed"] = {"codes": sorted(own), "note": f'"{", ".join(sorted(own))}" printed beside it, the code this symbol carries on the legend'}
            box = legend_entry_box(mods, m["legend_id"])
            if box:
                meta["legend_entry"] = box
            m["metadata"] = meta
            m["confidence_score"] = round(auto_high, 3)
            m["status"] = "ai_unverified"
            n += 1
    return n
