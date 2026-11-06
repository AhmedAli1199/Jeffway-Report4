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
    R = page.rect * page.rotation_matrix
    W, H = abs(R.width) or 1, abs(R.height) or 1
    x0, y0 = min(R.x0, R.x1), min(R.y0, R.y1)
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
    legend_sheet = (not title or bool(LEGEND_SHEET.search(title))) and n >= STRONG_LEGEND and not re.search(r"\b(plan|layout)\b", title, re.I) and _mostly_legend(rich)

    reasons: List[str] = []
    if title:
        reasons.append(f'Title: "{title}"')
    reasons.append(f"{n} legend description{'s' if n != 1 else ''} on the sheet" if n else "No legend descriptions on the sheet")

    if _is_register(rich):
        verdict = "no"
        title = title if not pos else "Cover sheet / drawing register"
        reasons = [f'Title: "{title}"', "Lists many drawings: a cover sheet or drawing register"]
    elif legend_sheet:
        verdict = "no"
        reasons.append("Looks like a legend/key sheet, not a plan")
    elif pos:
        verdict = "yes"
        reasons.append("Title names an electrical / M&E drawing")
    elif neg and n < STRONG_LEGEND:
        verdict = "maybe" if n >= SOME_LEGEND else "no"
        reasons.append("Title is an elevation/section/other drawing" + (" that mentions electrical items" if n >= SOME_LEGEND else ""))
    elif n >= STRONG_LEGEND:
        verdict = "yes"
        reasons.append("The electrical legend is printed on it")
    elif n >= SOME_LEGEND:
        verdict = "maybe"
        reasons.append("Some electrical items mentioned, but no full legend")
    else:
        verdict = "no"

    return {"title": title, "legend_hits": n, "verdict": verdict, "reasons": reasons}


def classify_pdf(path: Path) -> List[Dict[str, Any]]:
    out = []
    with fitz.open(str(path)) as doc:
        for i, page in enumerate(doc):
            c = classify_page(page)
            c.update({"page_index": i, "page_number": i + 1})
            out.append(c)
    return out
