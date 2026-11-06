"""
Read a developer's accommodation schedule (xlsx / xls / csv) and count plots per house type.

Every pack lays it out differently, so this looks for a header row that has a
house-type column ("House Type", "Type", "Unit Type"...) and, ideally, a plot column,
then counts one plot per data row below it.
"""
from __future__ import annotations

import csv
import re
from collections import Counter, OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional

TYPE_HEADERS = ("house type", "housetype", "unit type", "plot type", "dwelling type", "type")
PLOT_HEADERS = ("plot", "plot no", "plot number", "unit", "unit no")
TENURE_HEADERS = ("tenure",)
_STOP = {"the", "house", "type", "housetype", "plot", "plots"}


def norm_name(s: str) -> str:
    s = re.sub(r"_x[0-9a-fA-F]{4}_", "", str(s))  # Excel escape artefacts like _x001E_
    words = re.findall(r"[a-z0-9]+", s.lower())
    return " ".join(w for w in words if w not in _STOP)


def _rows(path: Path) -> Dict[str, List[List[Any]]]:
    suf = path.suffix.lower()
    if suf == ".csv":
        with open(path, newline="", encoding="utf-8-sig", errors="ignore") as f:
            return {"csv": [list(r) for r in csv.reader(f)]}
    if suf in (".xlsx", ".xlsm"):
        import openpyxl

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        return {ws.title: [list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}
    raise ValueError(f"Unsupported schedule format: {suf}")


def _cell(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def parse_schedule(path: Path) -> Optional[Dict[str, Any]]:
    """Returns {"sheet", "plots": {house_type: n}, "tenures": {house_type: {tenure: n}}, "total"} or None."""
    best = None
    for sheet, rows in _rows(path).items():
        for hi, row in enumerate(rows[:40]):
            heads = [_cell(c).lower().strip(" :") for c in row]
            t_col = next((i for i, h in enumerate(heads) if h in TYPE_HEADERS), None)
            if t_col is None:
                continue
            p_col = next((i for i, h in enumerate(heads) if h in PLOT_HEADERS), None)
            ten_col = next((i for i, h in enumerate(heads) if h in TENURE_HEADERS), None)
            counts: "OrderedDict[str, int]" = OrderedDict()
            tenures: Dict[str, Counter] = {}
            blank_run = 0
            for r in rows[hi + 1:]:
                ht = _cell(r[t_col]) if t_col < len(r) else ""
                plot = _cell(r[p_col]) if p_col is not None and p_col < len(r) else "x"
                if not ht:
                    blank_run += 1
                    if blank_run > 5:
                        break
                    continue
                blank_run = 0
                # Skip subtotal / repeated header rows
                if ht.lower() in TYPE_HEADERS or re.search(r"\btotal\b", ht.lower()) or not plot:
                    continue
                counts[ht] = counts.get(ht, 0) + 1
                if ten_col is not None and ten_col < len(r) and _cell(r[ten_col]):
                    tenures.setdefault(ht, Counter())[_cell(r[ten_col])] += 1
            score = sum(counts.values()) + (50 if p_col is not None else 0)
            if counts and (best is None or score > best[0]):
                best = (score, {
                    "sheet": sheet,
                    "plots": dict(counts),
                    "tenures": {k: dict(v) for k, v in tenures.items()},
                    "total": sum(counts.values()),
                })
    return best[1] if best else None


def match_house_type(name: str, schedule_plots: Dict[str, int]) -> Optional[str]:
    """Match a drawing name (e.g. 'The Avebury - Planning Set') to a schedule house type ('Avebury')."""
    n = norm_name(name)
    if not n:
        return None
    norm = {norm_name(k): k for k in schedule_plots}
    if n in norm:
        return norm[n]
    n_tokens = set(n.split())
    hits = []
    for nk, k in norm.items():
        if not nk:
            continue
        k_tokens = set(nk.split())
        if k_tokens and k_tokens <= n_tokens:  # every word of the schedule name appears in the drawing name
            hits.append((len(nk), k))
    return max(hits)[1] if hits else None


def find_schedule(pack_dir: Path) -> List[Path]:
    """Likely accommodation schedules in a pack, best guesses first."""
    cands = []
    for p in pack_dir.rglob("*"):
        if not p.is_file() or "__MACOSX" in p.parts or p.name.startswith(("._", "~$")):
            continue
        if p.suffix.lower() not in (".xlsx", ".xlsm", ".csv"):
            continue
        name = p.name.lower()
        rank = 0 if "accommodation" in name else 1 if "schedule" in name else 2
        cands.append((rank, p))
    return [p for _, p in sorted(cands)]


def plots_for(name: str, schedule_plots: Dict[str, int]) -> Optional[Dict[str, Any]]:
    """Plots for a drawing. Exact or more-specific match first; otherwise sum the schedule's
    variants of that type (e.g. drawing 'Ashton' = 'Ashton v1' + 'Ashton v2')."""
    exact = match_house_type(name, schedule_plots)
    if exact:
        return {"plots": schedule_plots[exact], "matched": [exact]}
    n_tokens = set(norm_name(name).split())
    if not n_tokens:
        return None
    variants = [k for k in schedule_plots if n_tokens <= set(norm_name(k).split())]
    if variants:
        return {"plots": sum(schedule_plots[k] for k in variants), "matched": variants}
    return None
