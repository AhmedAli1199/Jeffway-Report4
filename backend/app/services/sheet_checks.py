"""
The free checks run on each sheet's first-pass marks, in order, before anything is saved or sent to AI.

  1. Code letters (modifiers.py): HL / USB / 2 / 3 beside a mark decide which item it is.
  2. CAD layer (cad_layers.py): marks drawn on the wrong layer are marked down.
  3. Stroke pattern (shapes.py): marks drawn with exactly a symbol's CAD block are confirmed or moved,
     and copies of that block nothing marked are added.
  4. Switch plates: switches drawn touching on one wall are one multi-gang plate.
  5. Rooms (rooms.py): each mark gets its room; room rules (IP downlights in wet rooms) are applied.

The pipeline and the accuracy test both call TenderChecks.run, so what is measured is what runs.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from app.services import cad_layers, modifiers, pricing_rules, rooms, shapes

GANG_REACH = 1.6  # switch centres closer than this many symbol widths share one plate


def _switch_family(symbols: List[Dict[str, Any]], legend_of: Callable) -> Dict[str, Any]:
    fam, two = set(), None
    for s in symbols:
        lid, label = legend_of(s)["legend_id"], (legend_of(s)["label"] or "").lower()
        if re.search(r"\bgang\b", label) and "switch" in label and not re.search(r"grid|fused|spur|isolat|cooker|dimmer", label):
            fam.add(lid)
            if re.search(r"\b2 ?gang\b", label):
                two = lid
    return {"family": fam, "two_gang": two}


def gang_switches(marks: List[Dict[str, Any]], family: Dict[str, Any], min_score: float = 0.7) -> int:
    """Merge pairs of touching switch marks into one 2-gang plate. Returns plates made."""
    two = family["two_gang"]
    if not two:
        return 0
    sw = [m for m in marks if m["legend_id"] in family["family"] and m["confidence_score"] >= min_score
          and m.get("status") != "possible_missed"]
    sw.sort(key=lambda m: -m["confidence_score"])
    used, plates = set(), 0
    for i, a in enumerate(sw):
        if id(a) in used:
            continue
        size = max(a["width"], a["height"])
        ax, ay = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
        best, best_d = None, GANG_REACH * size
        for b in sw[i + 1:]:
            if id(b) in used:
                continue
            d = ((b["x"] + b["width"] / 2 - ax) ** 2 + (b["y"] + b["height"] / 2 - ay) ** 2) ** 0.5
            if d < best_d:
                best, best_d = b, d
        if best is None:
            continue
        used |= {id(a), id(best)}
        meta = dict(a.get("metadata") or {})
        meta["gang"] = {"from": [a["legend_id"], best["legend_id"]], "scores": [a["confidence_score"], best["confidence_score"]],
                        "note": "Two switches drawn side by side: one 2-gang plate"}
        x0, y0 = min(a["x"], best["x"]), min(a["y"], best["y"])
        x1 = max(a["x"] + a["width"], best["x"] + best["width"])
        y1 = max(a["y"] + a["height"], best["y"] + best["height"])
        a.update({"legend_id": two, "x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0, "metadata": meta,
                  "confidence_score": max(a["confidence_score"], best["confidence_score"])})
        best["_drop"] = True
        plates += 1
    marks[:] = [m for m in marks if not m.pop("_drop", False)]
    return plates


DETAIL_TITLE = re.compile(r"(?i)\blayout\b")
MAIN_TITLE = re.compile(r"(?i)electrical|m\s*&\s*e|floor plan")


def is_detail_sheet(title: str) -> bool:
    return bool(title) and bool(DETAIL_TITLE.search(title)) and not MAIN_TITLE.search(title)


def detail_sheet_repeats(sheets: List[Dict[str, Any]], groups: Dict[str, str], counted_at: float = 0.8) -> int:
    """A kitchen / bathroom layout repeats items already on the floor plan (ceiling lights) for coordination.

    sheets: one house type's sheets, each {"pdf", "page_index", "title", "marks"}. On a detail sheet, a symbol
    its own legend doesn't list, and that is counted on one of the house's main plans, is a repeat: it is
    marked down for review. Items drawn only on the detail sheet (a cooker control unit) stay counted."""
    def g(lid):
        return groups.get(lid, lid)

    main_counted = {g(m["legend_id"]) for sh in sheets if not is_detail_sheet(sh.get("title", ""))
                    for m in sh["marks"] if m["confidence_score"] >= counted_at}
    n = 0
    for sh in sheets:
        title = sh.get("title", "")
        if not is_detail_sheet(title):
            continue
        try:
            mods = modifiers.legend_modifiers(modifiers.sheet_words(str(sh["pdf"]), sh["page_index"]))
        except Exception:
            continue
        listed = {g(s) for s in mods.get("by_symbol", {})}
        if len(listed) < 2:
            continue  # no usable legend: nothing to go on
        for m in sh["marks"]:
            if g(m["legend_id"]) in listed or g(m["legend_id"]) not in main_counted or m.get("status") in ("user_verified", "manual_added"):
                continue
            if m["confidence_score"] < counted_at:
                continue
            meta = dict(m.get("metadata") or {})
            meta["detail_sheet"] = {"note": f'"{title}" is a detail sheet: this symbol isn\'t in its legend and is counted on the floor plan, so this is a repeat'}
            meta.setdefault("first_pass_score_before_detail", m["confidence_score"])
            m["metadata"] = meta
            m["confidence_score"] = round(min(m["confidence_score"], 0.5), 3)
            m["status"] = "needs_review"
            n += 1
    return n


def drop_same_spot(marks: List[Dict[str, Any]], groups: Dict[str, str]) -> int:
    """Two marks of one symbol on the same spot (e.g. after a mark was moved onto a symbol already there): keep the better."""
    keep: List[Dict[str, Any]] = []
    dropped = 0
    for m in sorted(marks, key=lambda m: -m["confidence_score"]):
        cx, cy = m["x"] + m["width"] / 2, m["y"] + m["height"] / 2
        r = 0.5 * max(m["width"], m["height"])
        g = groups.get(m["legend_id"], m["legend_id"])
        def same(k):
            if groups.get(k["legend_id"], k["legend_id"]) != g:
                return False
            kx, ky = k["x"] + k["width"] / 2, k["y"] + k["height"] / 2
            if abs(kx - cx) < r and abs(ky - cy) < r:
                return True
            # boxes of different sizes (a mark moved from a bigger symbol): mostly overlapping
            ix = min(k["x"] + k["width"], m["x"] + m["width"]) - max(k["x"], m["x"])
            iy = min(k["y"] + k["height"], m["y"] + m["height"]) - max(k["y"], m["y"])
            small = min(k["width"] * k["height"], m["width"] * m["height"])
            return ix > 0 and iy > 0 and small > 0 and ix * iy / small >= 0.3

        if m["confidence_score"] >= 0.6 and any(same(k) for k in keep):
            dropped += 1
            continue
        keep.append(m)
    marks[:] = keep
    return dropped


class TenderChecks:
    def __init__(self, symbols: List[Dict[str, Any]], legend_of: Callable, unique_key: str = "template_image_b64"):
        first: Dict[str, str] = {}
        for s in symbols:
            first.setdefault(s[unique_key], legend_of(s)["legend_id"])
        groups = {legend_of(s)["legend_id"]: first[s[unique_key]] for s in symbols}
        self.library_ids = {legend_of(s)["legend_id"] for s in symbols}
        self.groups = groups
        self.layers = cad_layers.LayerKnowledge(groups)
        self.shapes = shapes.ShapeKnowledge(groups)
        self.switches = _switch_family(symbols, legend_of)
        self.stats: Dict[str, int] = {"code": 0, "layer_down": 0, "layer_confirmed": 0, "shape_confirmed": 0,
                                      "shape_moved": 0, "shape_found": 0, "possible_missed": 0, "gangs": 0,
                                      "rooms": 0, "room_rule": 0}

    def run(self, pdf: Path, page_index: int, page_number: int, marks: List[Dict[str, Any]], auto_high: float,
            not_legend: Callable[[Dict[str, Any]], bool] = lambda m: True, title: str = "") -> List[Dict[str, Any]]:
        """Check one sheet's marks in place; returns the marks (with any added) to save."""
        st = self.stats
        for m in marks:
            m.setdefault("marker_id", f"mk_{uuid.uuid4().hex[:8]}")
        st["code"] += modifiers.apply_to_sheet(pdf, page_index, marks, self.library_ids)
        st["code_confirmed"] = st.get("code_confirmed", 0) + modifiers.confirm_by_code(pdf, page_index, marks, auto_high)
        paths = cad_layers.sheet_paths(str(pdf), page_index)
        words = modifiers.sheet_words(str(pdf), page_index)
        if cad_layers.has_layers(paths):
            try:
                st["legend_glyphs"] = st.get("legend_glyphs", 0) + self.shapes.learn_legend(
                    modifiers.legend_modifiers(words), paths, words)
            except Exception as e:
                print(f"[checks] legend glyphs skipped: {e}")
            self.layers.learn(marks, paths)
            self.shapes.learn(marks, paths)
            r = cad_layers.apply(marks, paths, self.layers, auto_high)
            st["layer_down"] += r["down"]
            st["layer_confirmed"] += r["confirmed"]
            r = self.shapes.apply(marks, paths, auto_high)
            st["shape_confirmed"] += r["confirmed"]
            st["shape_moved"] += r["moved"]
            # marks confirmed by their strokes are now confident: a code beside them (R = smoke test button) moves them
            confirmed = [m for m in marks if (m.get("metadata") or {}).get("shape_check")]
            if confirmed:
                st["code_after_shape"] = st.get("code_after_shape", 0) + modifiers.apply_to_sheet(
                    pdf, page_index, marks, self.library_ids, only=confirmed, relabel_only=True)
            found = [m for m in self.shapes.find_missed(marks, paths, auto_high) if not_legend(m)]
            for m in found:
                m["marker_id"] = f"mk_{uuid.uuid4().hex[:8]}"
            marks.extend(found)
            if found:  # its printed code decides the variant (2-way, intermediate, USB ...)
                modifiers.apply_to_sheet(pdf, page_index, marks, self.library_ids, only=found)
            st["shape_found"] += len(found)
            r = self.shapes.apply_letters(marks, paths, words, auto_high)
            lf = [m for m in r["found"] if not_legend(m)]
            for m in lf:
                m["marker_id"] = f"mk_{uuid.uuid4().hex[:8]}"
            marks.extend(lf)
            st["letter_confirmed"] = st.get("letter_confirmed", 0) + r["confirmed"]
            st["letter_found"] = st.get("letter_found", 0) + len(lf)
            gaps = [m for m in cad_layers.possible_missed(marks, paths, self.layers) if not_legend(m)]
            marks.extend(gaps)
            st["possible_missed"] += len(gaps)
        st["duplicates"] = st.get("duplicates", 0) + drop_same_spot(marks, self.groups)
        st["gangs"] += gang_switches(marks, self.switches)
        try:  # pricing context: what a spur feeds, coax at the media plate (services/pricing_rules.py)
            st["price_context"] = st.get("price_context", 0) + pricing_rules.mark_context(marks, words)
        except Exception as e:
            print(f"[checks] pricing context skipped: {e}")
        r = rooms.apply(str(pdf), page_index, marks, self.library_ids)
        st["rooms"] += r["rooms"]
        st["room_rule"] += r["rule"]
        for m in marks:
            m.setdefault("marker_id", f"mk_{uuid.uuid4().hex[:8]}")
            m.setdefault("page_index", page_index)
            m.setdefault("page_number", page_number)
            m.setdefault("room", "Unassigned")
        return marks

    def finish_house(self, sheets: List[Dict[str, Any]]) -> int:
        """After all of one house type's sheets: drop detail-sheet repeats. Returns marks changed."""
        n = detail_sheet_repeats(sheets, self.groups)
        self.stats["detail_repeats"] = self.stats.get("detail_repeats", 0) + n
        return n
