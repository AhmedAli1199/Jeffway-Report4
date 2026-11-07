"""
How counted symbols become quantities on Jeffway's tender workbook.

The drawings say what is on the wall; Jeffway's workbook says what they buy and fit. Most symbols map one
to one through the library's sheet_row, but a few don't. These rules were read off Jeffway's own filled-in
workbook (26 house / flat tabs) and the Curo drawings, and are waiting for Jeffway to confirm. Every rule
can be switched off or changed in data/pricing_rules.json without touching code.

  1. not_priced        symbols Jeffway doesn't price on houses (extract fans: supplied by others; blanking plates)
  2. adds              one symbol brings other items with it (a media plate includes 2 double sockets;
                       a cooker control unit feeds a 45A cooker outlet)
  3. price_as          a symbol priced on another row (oven / hob flex outlet plate -> unswitched single socket)
  4. spur_by_place     the one "fused spur to extract fans and cylinder" symbol is priced by what it feeds:
                       in the airing cupboard -> 20A DP switch engraved Water Heater; by the loft hatch ->
                       20A DP switch engraved Loft Light; the rest -> first one Switched Fused Spur Extractor
                       Fan, any more 20A DP Switch
  5. coax_satellite    coax drawn at the media plate / Sky entry is the satellite feed, not a TV point
  6. per_house_kit     items every house gets that aren't drawn (consumer unit parts, junction boxes ...)
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

RULES_FILE = Path(__file__).resolve().parents[2] / "data" / "pricing_rules.json"

DEFAULT_RULES: Dict[str, Any] = {
    "not_priced": {
        "sym_extract_fan_continuous": "Extract fans: Jeffway prices fans (row 92) only on the EMA and apartment tabs, never on houses",
        "sym_blanking_plate": "Blanking plates: the Twin Blank row is empty on all 26 tabs",
    },
    "adds": {
        "sym_media_plate": [[21, 2, "The media plate's legend entry includes 'Double sockets (2)'"]],
    },
    "price_as": {
        "sym_cooker_outlet": [19, "Oven / hob flex outlet plates on the kitchen layout are priced as unswitched single sockets"],
    },
    "spur_by_place": {
        "symbol": "sym_fused_spur_extract",
        "places": [
            ["\\bA\\s*/\\s*C\\b|airing|cylinder|hot water", 33, "Spur in the airing cupboard: the cylinder / water heater"],
            ["\\bloft\\b", 34, "Spur by the loft hatch: the loft light"],
        ],
        "first_row": 30, "first_why": "First spur for the extract fans: Switched Fused Spur Extractor Fan",
        "rest_row": 32, "rest_why": "Further extract-fan spurs: 20A Double Pole Switch",
        "reach_px": 160,
        # Not labelled on most plans: a house with a loft has one loft-light spur, a heat-pump house one cylinder spur
        "fallback": [[34, "loft", "One spur per house with a loft is the loft light (the hatch is rarely labelled)"],
                     [33, "cylinder", "One spur per heat-pump house is the hot-water cylinder"]],
    },
    "coax_satellite": {
        "symbol": "sym_tv_coaxial",
        "near_symbol": "sym_media_plate", "near_px": 260,
        "text": "\\bSKY\\b|\\bSAT\\b|satellite|coiled",
        "why": "Coax at the media plate / Sky entry is the satellite feed, part of the media plate, not a TV point",
    },
    "one_per_house": {
        "why": "Jeffway prices exactly one on every house tab; the drawing doesn't reliably show it",
        "rows": {"10": "Split load heat pump board (the consumer unit)", "37": "45A cooker control unit", "38": "45A cooker outlet"},
    },
    "per_house_kit": {
        "enabled": False,
        "why": "Standard items every house gets that aren't drawn (most common value on Jeffway's 26 tabs)",
        "rows": {"12": 1, "13": 4, "14": 1, "15": 1, "16": 4, "17": 4, "29": 1, "31": 1, "43": 1, "44": 1, "45": 1,
                 "46": 1, "75": 2, "76": 1, "88": 4, "89": 1, "90": 0.3, "91": 0.1, "107": 0.15},
    },
}


def load_rules() -> Dict[str, Any]:
    try:
        rules = json.loads(RULES_FILE.read_text())
        return {**DEFAULT_RULES, **rules}
    except Exception:
        return DEFAULT_RULES


def mark_context(marks: List[Dict[str, Any]], words, rules: Optional[Dict[str, Any]] = None) -> int:
    """Sheet-level rules that need the drawing around a mark (text beside it, what it sits next to).

    Sets metadata["price"] = {"row": int | None, "why": str} on the marks they apply to. Returns marks set."""
    rules = rules or load_rules()
    n = 0
    sp = rules.get("spur_by_place") or {}
    if sp:
        reach = sp.get("reach_px", 160)
        for m in marks:
            if m["legend_id"] != sp["symbol"]:
                continue
            cx, cy = m["x"] + m["width"] / 2, m["y"] + m["height"] / 2
            near = " ".join(w[4] for w in words if abs((w[0] + w[2]) / 2 - cx) <= reach and abs((w[1] + w[3]) / 2 - cy) <= reach)
            for pattern, row, why in sp["places"]:
                if re.search(pattern, near, re.I):
                    m.setdefault("metadata", {})["price"] = {"row": int(row), "why": why, "rule": "spur_by_place"}
                    n += 1
                    break
    cs = rules.get("coax_satellite") or {}
    if cs:
        plates = [m for m in marks if m["legend_id"] == cs["near_symbol"]]
        for m in marks:
            if m["legend_id"] != cs["symbol"]:
                continue
            cx, cy = m["x"] + m["width"] / 2, m["y"] + m["height"] / 2
            by_plate = any(abs(p["x"] + p["width"] / 2 - cx) <= cs["near_px"] and abs(p["y"] + p["height"] / 2 - cy) <= cs["near_px"] for p in plates)
            near = " ".join(w[4] for w in words if abs((w[0] + w[2]) / 2 - cx) <= cs["near_px"] and abs((w[1] + w[3]) / 2 - cy) <= cs["near_px"])
            if by_plate or re.search(cs["text"], near, re.I):
                m.setdefault("metadata", {})["price"] = {"row": None, "why": cs["why"], "rule": "coax_satellite"}
                n += 1
    return n


def workbook_rows(markers: List[Dict[str, Any]], library: Dict[str, Dict[str, Any]],
                  rules: Optional[Dict[str, Any]] = None, house: Optional[Dict[str, bool]] = None
                  ) -> Tuple[Dict[int, float], List[Tuple[int, float, str]], Dict[str, int]]:
    """Quantities per workbook row for one house type's counted marks.

    Returns (counts, notes, unmapped): notes are (row, qty, why) for every quantity a rule produced."""
    rules = rules or load_rules()
    house = house if house is not None else {"loft": True, "cylinder": True, "dwelling": True}
    counts: Dict[int, float] = {}
    notes: Dict[Tuple[int, str], float] = {}
    unmapped: Dict[str, int] = {}

    def add(row: int, q: float, why: Optional[str] = None) -> None:
        counts[row] = counts.get(row, 0) + q
        if why:
            notes[(row, why)] = notes.get((row, why), 0) + q

    sp = rules.get("spur_by_place") or {}
    free_spurs = 0
    for m in markers:
        lid = m.get("legend_id") or ""
        entry = library.get(lid)
        if not entry:
            unmapped[lid] = unmapped.get(lid, 0) + 1
            continue
        price = (m.get("metadata") or {}).get("price")
        if price is not None and price.get("rule") and not rules.get(price["rule"]):
            price = None  # that rule is switched off
        if price is not None:
            if price.get("row") is not None:
                add(int(price["row"]), 1, price.get("why"))
            continue
        if lid in rules.get("not_priced", {}):
            notes[(0, rules["not_priced"][lid])] = notes.get((0, rules["not_priced"][lid]), 0) + 1
            continue
        if sp and lid == sp.get("symbol"):
            free_spurs += 1
            continue
        if lid in rules.get("price_as", {}):
            row, why = rules["price_as"][lid]
            add(int(row), 1, why)
        elif entry.get("sheet_row"):
            row = int(entry["sheet_row"])
            ov = entry.get("room_override")
            if ov and any(z in str(m.get("room") or "").lower() for z in ov.get("zones", [])):
                row = int(ov.get("override_row", row))
            add(row, 1)
        else:
            unmapped[lid] = unmapped.get(lid, 0) + 1
        for row, q, why in rules.get("adds", {}).get(lid, []):
            add(int(row), q, why)
    for row, need, why in (sp.get("fallback") or []):
        if free_spurs >= 2 and house.get(need) and not counts.get(int(row)):
            add(int(row), 1, why)
            free_spurs -= 1
    if free_spurs:
        add(int(sp["first_row"]), 1, sp["first_why"])
        if free_spurs > 1:
            add(int(sp["rest_row"]), free_spurs - 1, sp["rest_why"])
    one = rules.get("one_per_house") or {}
    if house.get("dwelling"):
        for row, what in (one.get("rows") or {}).items():
            if not counts.get(int(row)):
                add(int(row), 1, f'{what}: {one.get("why", "")}')
            elif counts[int(row)] > 1:
                notes[(int(row), f"{what}: more than one found, kept for review")] = counts[int(row)]
    kit = rules.get("per_house_kit") or {}
    if kit.get("enabled"):
        for row, q in kit.get("rows", {}).items():
            if int(row) not in counts:
                add(int(row), q, kit.get("why"))
    return counts, [(r, q, w) for (r, w), q in notes.items()], unmapped
