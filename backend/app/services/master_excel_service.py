import openpyxl
from pathlib import Path
import json
from typing import Dict, List, Any, Optional
from datetime import datetime
import shutil

from app.core.config import BASE_DIR

class MasterExcelService:
    TEMPLATE_PATH = BASE_DIR.parent / "Report 4 Excel Sheets" / "Jeff Way Group - Electrical Tender - Curo - Bath Road, Keynsham - Rev A.xlsx"
    LIBRARY_PATH = BASE_DIR / "data" / "symbol_library.json"

    @classmethod
    def load_symbol_library(cls) -> List[Dict[str, Any]]:
        if cls.LIBRARY_PATH.exists():
            with open(cls.LIBRARY_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

    @classmethod
    def save_symbol_library(cls, library: List[Dict[str, Any]]):
        cls.LIBRARY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(cls.LIBRARY_PATH, "w", encoding="utf-8") as f:
            json.dump(library, f, indent=2)

    # Rows that follow 1:1 from a counted item (checked against Jeffway's filled Curo workbook)
    LINKED_ROWS = {
        62: (63, "1 low energy lamp per pendant"),
        64: (65, "1 low energy lamp per batten holder"),
        68: (69, "1 back box per media plate"),
    }

    @staticmethod
    def _house_tabs(wb) -> List[str]:
        return [ws.title for ws in wb.worksheets if str(ws.cell(1, 1).value or "").strip().lower() == "2nd fix takeoff"]

    @staticmethod
    def _match_tab(name: str, tabs: List[str]) -> Optional[str]:
        from app.services.schedule_service import norm_name

        n = norm_name(name)
        if not n:
            return None
        by_norm = {norm_name(t): t for t in tabs}
        if n in by_norm:
            return by_norm[n]
        n_tokens = set(n.split())
        hits = [(len(k), t) for k, t in by_norm.items() if k and set(k.split()) <= n_tokens]
        return max(hits)[1] if hits else None

    @classmethod
    def generate_tender_workbook(
        cls,
        houses: List[Dict[str, Any]],
        tender_name: str,
        output_path: str | Path,
        basis: str = "",
    ) -> Path:
        """
        Fill Jeffway's tender workbook from the takeoff.

        The only template we have is the Curo workbook the estimators already filled in, so first every
        typed quantity and plot count on every house-type tab is cleared (formulas, prices and labour rates
        are kept). Then, for each house type, the counted symbols go into the Qty column via the symbol
        library's sheet_row, and plots into D6. Everything else is left blank for the estimator, and a
        "Plotline takeoff" sheet records where each number came from.

        houses: [{"name", "plots", "markers": [...], "plot_source"}]
        """
        if not cls.TEMPLATE_PATH.exists():
            raise FileNotFoundError(f"Tender workbook template not found at {cls.TEMPLATE_PATH}")
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        library = cls.load_symbol_library()
        by_id = {(i.get("legend_id") or i.get("symbol_id")): i for i in library}
        by_label = {str(i.get("cad_label", "")).lower(): i for i in library}

        wb = openpyxl.load_workbook(str(cls.TEMPLATE_PATH), data_only=False)
        tabs = cls._house_tabs(wb)

        # 1. Blank every house-type tab: typed quantities and plot counts only
        cleared = 0
        for name in tabs:
            ws = wb[name]
            for r in range(10, ws.max_row + 1):
                v = ws.cell(r, 1).value
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    ws.cell(r, 1).value = None
                    cleared += 1
            if isinstance(ws.cell(6, 4).value, (int, float)):
                ws.cell(6, 4).value = 0

        audit_rows = []
        summary = []
        for h in houses:
            tab = cls._match_tab(h["name"], tabs)
            from app.services import pricing_rules
            counts, rule_notes, unmapped = pricing_rules.workbook_rows(h.get("markers", []), by_id, house=h.get("house"))
            per_symbol: Dict[str, Dict[str, Any]] = {}
            for m in h.get("markers", []):
                lid = m.get("legend_id") or m.get("symbol_id") or ""
                entry = by_id.get(lid)
                if not entry or not entry.get("sheet_row"):
                    continue
                ps = per_symbol.setdefault(lid, {"label": entry.get("cad_label") or lid, "row": int(entry["sheet_row"]), "n": 0, "approved": 0, "ai": 0})
                ps["n"] += 1
                if m.get("status") in ("user_verified", "manual_added"):
                    ps["approved"] += 1
                elif m.get("status") == "ai_verified":
                    ps["ai"] += 1

            linked = {}
            for src, (dst, why) in cls.LINKED_ROWS.items():
                if counts.get(src):
                    linked[dst] = (counts[src], why)

            if tab:
                ws = wb[tab]
                for row, n in counts.items():
                    ws.cell(row, 1).value = n
                for row, (n, _) in linked.items():
                    ws.cell(row, 1).value = n
                ws.cell(6, 4).value = int(h.get("plots") or 1)
            summary.append({
                "name": h["name"], "tab": tab, "plots": h.get("plots") or 1, "plot_source": h.get("plot_source") or "",
                "points": sum(counts.values()), "unmapped": unmapped,
            })
            for lid, ps in sorted(per_symbol.items(), key=lambda x: x[1]["row"]):
                desc = wb[tab].cell(ps["row"], 4).value if tab else ""
                audit_rows.append([h["name"], tab or "NOT IN WORKBOOK", ps["label"], ps["row"], cls._resolve_desc(wb, desc), ps["n"], ps["approved"], ps["ai"], ps["n"] - ps["approved"] - ps["ai"]])
            for row, (n, why) in linked.items():
                desc = wb[tab].cell(row, 4).value if tab else ""
                audit_rows.append([h["name"], tab or "NOT IN WORKBOOK", f"(linked) {why}", row, cls._resolve_desc(wb, desc), n, "", "", ""])
            for row, q, why in sorted(rule_notes, key=lambda x: x[0]):
                desc = wb[tab].cell(row, 4).value if (tab and row) else "not priced"
                audit_rows.append([h["name"], tab or "NOT IN WORKBOOK", f"(pricing rule) {why}", row or "-", cls._resolve_desc(wb, desc) if row else desc, q, "", "", ""])

        # 2. Audit sheet
        if "Plotline takeoff" in wb.sheetnames:
            del wb["Plotline takeoff"]
        au = wb.create_sheet("Plotline takeoff", 0)
        au["A1"] = f"Plotline takeoff · {tender_name}"
        au["A2"] = f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}. {basis}"
        au["A3"] = (f"Every typed quantity and plot count on the {len(tabs)} house-type tabs was cleared first "
                    f"({cleared} cells); only the numbers below were filled in. Prices, labour rates and formulas are unchanged. "
                    "Items that can't be read off the drawings (RCBOs, modules, junction boxes, sleeving, isolators, etc.) are left for the estimator, "
                    "unless the per-house kit is switched on in data/pricing_rules.json. Lines marked (pricing rule) come from the rules in that file.")
        au["A5"] = "House type"; au["B5"] = "Workbook tab"; au["C5"] = "Plots"; au["D5"] = "Plots from"; au["E5"] = "Points filled"; au["F5"] = "Symbols with no workbook row"
        r = 6
        for sm in summary:
            au.cell(r, 1, sm["name"]); au.cell(r, 2, sm["tab"] or "No matching tab: not filled")
            au.cell(r, 3, sm["plots"]); au.cell(r, 4, sm["plot_source"]); au.cell(r, 5, sm["points"])
            au.cell(r, 6, ", ".join(f"{k} ×{v}" for k, v in sm["unmapped"].items()) or "")
            r += 1
        r += 1
        heads = ["House type", "Tab", "Symbol (drawing)", "Row", "Workbook line", "Qty per plot", "Approved", "AI-confirmed", "Unreviewed"]
        for c, hd in enumerate(heads, 1):
            au.cell(r, c, hd)
        hdr_row = r
        for row in audit_rows:
            r += 1
            for c, v in enumerate(row, 1):
                au.cell(r, c, v)
        from openpyxl.styles import Font
        for c in range(1, 10):
            au.cell(5, c).font = Font(bold=True)
            au.cell(hdr_row, c).font = Font(bold=True)
        au["A1"].font = Font(bold=True, size=14)
        for col, w in zip("ABCDEFGHI", (28, 22, 44, 6, 44, 12, 10, 12, 11)):
            au.column_dimensions[col].width = w

        # Make Excel recalculate every formula on open (openpyxl keeps no cached values)
        try:
            wb.calculation.fullCalcOnLoad = True
        except Exception:
            pass
        wb.save(str(output_path))
        return output_path

    @staticmethod
    def _resolve_desc(wb, desc):
        """House tabs pull descriptions from '2nd Fix TOTALS' by formula; show the text instead."""
        import re
        if isinstance(desc, str) and desc.startswith("="):
            m = re.match(r"='?([^'!]+)'?!([A-Z]+)(\d+)", desc)
            if m and m.group(1) in wb.sheetnames:
                v = wb[m.group(1)][f"{m.group(2)}{m.group(3)}"].value
                return v if not (isinstance(v, str) and v.startswith("=")) else desc
        return desc

    @classmethod
    def generate_master_tender(
        cls,
        house_type_name: str,
        markers: List[Dict[str, Any]],
        output_path: Optional[str | Path] = None,
        plots: int = 1,
        plot_source: str = "",
    ) -> Path:
        """One house type into a blank copy of the tender workbook (see generate_tender_workbook)."""
        if not output_path:
            exports_dir = BASE_DIR / "data" / "exports"
            output_path = exports_dir / f"Jeffway_Tender_{house_type_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return cls.generate_tender_workbook(
            [{"name": house_type_name, "plots": plots, "markers": markers, "plot_source": plot_source}],
            tender_name=house_type_name,
            output_path=output_path,
            basis="Export of a single house type from the drawing workspace.",
        )
