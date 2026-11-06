"""
Decide which pages of a drawing PDF are electrical plans worth counting.

The PDFs come straight from CAD, so their text is real. Each page is judged on:
  1. its own title (read from the title block), and
  2. how many symbol descriptions from the library are printed on it. An electrical
     plan carries its legend, so the Avebury ground floor has 28; architectural
     sheets have 0, and elevations that mention a few sockets have 3-6.

Verdicts:
  "yes"    include: the title says electrical/lighting/power/M&E, or the legend is on the sheet
  "maybe"  left out, but flagged for a person: some electrical evidence, not enough
  "no"     left out
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

import fitz

POSITIVE = re.compile(r"\b(electrical|electric|elec|lighting|small power|power|m\s*&\s*e|mechanical\s*(?:&|and)\s*electrical|services|containment|fire alarm)\b", re.I)
NEGATIVE = re.compile(r"\b(elevations?|sections?|foundations?|joists?|setting out|drainage|site plan|sales|landscap\w*|external works|structural|roof truss|window|door schedule|details?)\b", re.I)
LEGEND_SHEET = re.compile(r"\b(legend|key|symbols?)\b", re.I)
TITLE_LINE = re.compile(r"\b(plan|layout|elevations?|sections?|details?|schedule|arrangement|legend|key)\b", re.I)
_STOP = {"a", "an", "and", "the", "of", "to", "for", "in", "at", "on", "with", "or", "level"}

STRONG_LEGEND = 8   # this many library descriptions on a sheet = the legend is printed on it
SOME_LEGEND = 3


def tokens(s: str) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in _STOP and len(w) > 1}


@lru_cache(maxsize=1)
def _library_tokens() -> tuple:
    from app.services.master_excel_service import MasterExcelService

    out = []
    for s in MasterExcelService.load_symbol_library():
        for text in (s.get("label"), s.get("cad_label"), s.get("sheet_desc")):
            t = tokens(text or "")
            if len(t) >= 2:
                out.append((s.get("legend_id") or s.get("symbol_id"), frozenset(t)))
    return tuple(out)


def _lines(page: "fitz.Page") -> List[Dict[str, Any]]:
    """Text lines with font size and position (0-1, in the rendered, rotated sheet)."""
    W, H = page.rect.width or 1, page.rect.height or 1  # displayed size (rotation already applied)
    x0, y0 = 0.0, 0.0
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            txt = " ".join(sp["text"] for sp in l["spans"]).strip()
            if not txt:
                continue
            r = fitz.Rect(l["bbox"]) * page.rotation_matrix
            out.append({
                "text": re.sub(r"\s+", " ", txt),
                "size": max(sp["size"] for sp in l["spans"]),
                "rx": ((r.x0 + r.x1) / 2 - x0) / W,
                "ry": ((r.y0 + r.y1) / 2 - y0) / H,
            })
    return out


def _title(lines: List[Dict[str, Any]]) -> str:
    """The drawing title from the title block (right-hand column or bottom strip of the sheet)."""
    def ok(l):
        t = l["text"]
        return (
            TITLE_LINE.search(t) and 3 <= len(t) <= 50
            and not re.match(r"(?i)(refer|see |note|to be|all |the |this |electrical layout to)", t)
            and not re.search(r"(?i)\blegend\b", t)
            and not re.fullmatch(r"(?i)(key|key plan|plan|section|details?|layout)\W*", t)
        )
    cands = [l for l in lines if ok(l)]
    if not cands:
        return ""
    block = [l for l in cands if l["rx"] >= 0.72 or l["ry"] >= 0.85]
    pool = block or cands
    best = max(pool, key=lambda l: (round(l["size"], 0), l["text"].isupper(), l["rx"] + l["ry"]))
    t = best["text"]
    return t.title().replace("M&E", "M&E").replace("M&e", "M&E") if t.isupper() else t


def _is_register(lines: List[Dict[str, Any]]) -> bool:
    """Cover sheets list every drawing in the set: many distinct drawing titles on one page."""
    titles = {l["text"].lower() for l in lines if TITLE_LINE.search(l["text"]) and 6 <= len(l["text"]) <= 60}
    return len(titles) >= 10 and sum(1 for l in lines if re.search(r"(?i)drawing (register|schedule|issue)|amended drawings|drawing no", l["text"])) >= 1


def _mostly_legend(rich: List[Dict[str, Any]]) -> bool:
    """A sheet that is only a symbol key: lots of text, the word legend/key, and no drawing title."""
    return any(re.search(r"(?i)\b(legend|key to symbols|symbol key)\b", l["text"]) and l["size"] >= 9 for l in rich)


LEGEND_HEAD = re.compile(r"(?i)\b(legend|key|symbols?|symbol key|key to symbols)\b")


def _matches_library(text: str, lib) -> set:
    lt = tokens(text)
    if len(lt) < 2:
        return set()
    return {sid for sid, st in lib if len(lt & st) >= 2 and len(lt & st) / min(len(lt), len(st)) >= 0.6}


def _legend_block(rich: List[Dict[str, Any]], lib) -> Dict[str, Any]:
    """Find a printed symbol legend: a heading (Legend / Key / Symbols) with library descriptions
    stacked beneath it in a column. Callout notes scattered over a plan don't qualify."""
    hits = [(l, _matches_library(l["text"], lib)) for l in rich]
    hits = [(l, ids) for l, ids in hits if ids]
    best = {"symbols": 0, "heading": None}
    for h in rich:
        t = h["text"].strip()
        if len(t) > 40 or not LEGEND_HEAD.search(t):
            continue
        under = set()
        for l, ids in hits:
            dx = l["rx"] - h["rx"]
            dy = l["ry"] - h["ry"]
            # below the heading, in its column (a wide legend may run to a second column)
            if 0 < dy <= 0.75 and -0.06 <= dx <= 0.30:
                under |= ids
        if len(under) > best["symbols"]:
            best = {"symbols": len(under), "heading": t}
    if best["symbols"] < LEGEND_MIN:
        # No heading: accept a tight column of descriptions (5+ lines left-aligned, close together)
        col = sorted((l for l, _ in hits), key=lambda l: (round(l["rx"], 2), l["ry"]))
        for i in range(len(col)):
            group = [c for c in col if abs(c["rx"] - col[i]["rx"]) <= 0.03 and 0 <= c["ry"] - col[i]["ry"] <= 0.35]
            ids = set().union(*(_matches_library(c["text"], lib) for c in group)) if group else set()
            if len(group) >= 5 and len(ids) > best["symbols"]:
                best = {"symbols": len(ids), "heading": None}
    return best


PLOTS_LINE = re.compile(r"(?i)^(opp|as|handed|plots?)\s*[:\-]\s*\d")
LEGEND_MIN = 3  # a legend block lists at least this many library symbols


def classify_page(page: "fitz.Page") -> Dict[str, Any]:
    rich = _lines(page)
    title = _title(rich)
    lines = [l["text"] for l in rich]
    lib = _library_tokens()
    hits = set()
    for l in lines:
        lt = tokens(l)
        if len(lt) < 2:
            continue
        for sid, st in lib:
            common = len(lt & st)
            if common >= 2 and common / min(len(lt), len(st)) >= 0.6:
                hits.add(sid)
    n = len(hits)

    pos = bool(POSITIVE.search(title))
    neg = bool(NEGATIVE.search(title)) and not pos
    legend = _legend_block(rich, lib)
    has_legend = legend["symbols"] >= LEGEND_MIN
    plan_like = bool(re.search(r"(?i)\b(plan|layout)\b", title))
    legend_only = has_legend and not plan_like and bool(LEGEND_HEAD.search(title or "legend")) and n <= legend["symbols"] + 1 and not title

    reasons: List[str] = []
    if title:
        reasons.append(f'Title: "{title}"')
    if has_legend:
        reasons.append(f'Electrical legend on the sheet ({legend["symbols"]} symbols{" under " + chr(34) + legend["heading"] + chr(34) if legend["heading"] else ""})')
    elif n:
        reasons.append(f"No legend block; {n} electrical item{'s' if n != 1 else ''} mentioned in notes")
    else:
        reasons.append("No legend and no electrical items mentioned")

    if _is_register(rich):
        verdict = "no"
        title = title if not pos else "Cover sheet / drawing register"
        reasons = [f'Title: "{title}"', "Lists many drawings: a cover sheet or drawing register"]
    elif has_legend and legend_only:
        verdict = "no"
        reasons.append("A legend/key sheet on its own, not a plan to count")
    elif has_legend and neg:
        verdict = "maybe"
        reasons.append("Has an electrical legend but the title says elevation/section: check it")
    elif has_legend:
        verdict = "yes"
        reasons.append("Counted: an electrical plan carries its own legend")
    elif pos:
        verdict = "maybe"
        reasons.append("Electrical title but no legend: its symbols may already be on the floor plans, so check before counting")
    elif n >= SOME_LEGEND:
        verdict = "maybe"
        reasons.append("Mentions electrical items but has no legend: likely shown on the main plans already")
    else:
        verdict = "no"

    plots = [l["text"] for l in rich if PLOTS_LINE.match(l["text"].strip())][:3]
    if plots and verdict != "no":
        reasons.append("For plots " + " · ".join(plots))
    return {"title": title, "legend_hits": n, "legend_symbols": legend["symbols"], "verdict": verdict,
            "reasons": reasons, "plots_note": " · ".join(plots)}


def classify_pdf(path: Path) -> List[Dict[str, Any]]:
    out = []
    with fitz.open(str(path)) as doc:
        for i, page in enumerate(doc):
            c = classify_page(page)
            c.update({"page_index": i, "page_number": i + 1})
            out.append(c)
    # The same drawing title twice usually means a second version for other plots (handed / alternative).
    # Counting both under one house type double-counts, so keep the first and flag the rest.
    first: Dict[str, Dict[str, Any]] = {}
    for c in out:
        if c["verdict"] != "yes" or not c["title"]:
            continue
        key = c["title"].lower()
        if key in first:
            f = first[key]
            c["verdict"] = "maybe"
            c["reasons"].append(
                f"Same title as p.{f['page_number']}: a second version"
                + (f" ({c['plots_note']} vs {f['plots_note']})" if c.get("plots_note") and f.get("plots_note") else "")
                + ". Counting both in one house type would double-count"
            )
        else:
            first[key] = c
    return out
