import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime

class ExcelService:
    @staticmethod
    def generate_takeoff_spreadsheet(
        project_name: str,
        filename: str,
        legends: List[Dict[str, Any]],
        markers: List[Dict[str, Any]],
        output_path: str | Path
    ) -> str:
        """
        Generates a 3-tab audit-ready Excel workbook formatted to Jeffway Construction Ltd's
        estimating standards.
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        wb = openpyxl.Workbook()
        
        # Styles
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid") # Dark Slate
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        subhead_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
        title_font = Font(name="Calibri", size=15, bold=True, color="0F172A")
        bold_font = Font(name="Calibri", size=11, bold=True)
        thin_border = Border(
            left=Side(style='thin', color='CBD5E1'),
            right=Side(style='thin', color='CBD5E1'),
            top=Side(style='thin', color='CBD5E1'),
            bottom=Side(style='thin', color='CBD5E1')
        )
        center_align = Alignment(horizontal="center", vertical="center")
        left_align = Alignment(horizontal="left", vertical="center")
        right_align = Alignment(horizontal="right", vertical="center")

        # ----------------------------------------------------
        # SHEET 1: Consolidated Bill of Quantities (BoQ)
        # ----------------------------------------------------
        ws1 = wb.active
        ws1.title = "Consolidated BoQ"
        ws1.views.sheetView[0].showGridLines = True
        
        # Title Block
        ws1["A1"] = "JEFFWAY CONSTRUCTION LTD - ELECTRICAL ESTIMATING TAKEOFF"
        ws1["A1"].font = title_font
        ws1["A2"] = f"Project: {project_name} | Document: {filename} | Generated: {datetime.now().strftime('%d/%m/%Y %H:%M')}"
        ws1["A2"].font = Font(italic=True, color="64748B", size=10)
        
        headers_1 = [
            "Item No", "Symbol / Component Label", "Fix Stage", "Manufacturer", 
            "Part Code", "High Conf (≥85%)", "Review (70-84%)", "Manual Added", "Total Count", "Status"
        ]
        
        for col_num, h in enumerate(headers_1, 1):
            cell = ws1.cell(row=4, column=col_num, value=h)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = center_align

        # Map legends
        legend_lookup = {leg["legend_id"]: leg for leg in legends}
        counts_by_legend = {}
        for leg in legends:
            counts_by_legend[leg["legend_id"]] = {
                "high": 0, "review": 0, "manual": 0, "total": 0
            }

        for m in markers:
            lid = m.get("legend_id")
            if lid in counts_by_legend:
                status = m.get("status", "ai_unverified")
                if status == "manual_added":
                    counts_by_legend[lid]["manual"] += 1
                elif status == "needs_review":
                    counts_by_legend[lid]["review"] += 1
                else:
                    counts_by_legend[lid]["high"] += 1
                counts_by_legend[lid]["total"] += 1

        row_idx = 5
        for item_idx, leg in enumerate(legends, 1):
            lid = leg["legend_id"]
            cnt = counts_by_legend[lid]
            stage = leg.get("fix_stage", "2nd Fix")
            mfr = leg.get("manufacturer", "Deta")
            part = leg.get("part_code", "Slimline Standard")
            
            ws1.cell(row=row_idx, column=1, value=item_idx).alignment = center_align
            ws1.cell(row=row_idx, column=2, value=leg.get("label", "Unknown")).alignment = left_align
            ws1.cell(row=row_idx, column=3, value=stage).alignment = center_align
            ws1.cell(row=row_idx, column=4, value=mfr).alignment = center_align
            ws1.cell(row=row_idx, column=5, value=part).alignment = center_align
            ws1.cell(row=row_idx, column=6, value=cnt["high"]).alignment = center_align
            ws1.cell(row=row_idx, column=7, value=cnt["review"]).alignment = center_align
            ws1.cell(row=row_idx, column=8, value=cnt["manual"]).alignment = center_align
            ws1.cell(row=row_idx, column=9, value=cnt["total"]).alignment = center_align
            ws1.cell(row=row_idx, column=10, value="Ready" if cnt["review"] == 0 else "Review Pending").alignment = center_align

            for c in range(1, 11):
                ws1.cell(row=row_idx, column=c).border = thin_border
            row_idx += 1

        # Totals row
        ws1.cell(row=row_idx, column=2, value="TOTAL TAKE-OFF ITEMS").font = bold_font
        ws1.cell(row=row_idx, column=9, value=f"=SUM(I5:I{row_idx-1})").font = bold_font
        ws1.cell(row=row_idx, column=9).alignment = center_align
        for c in range(1, 11):
            ws1.cell(row=row_idx, column=c).fill = subhead_fill
            ws1.cell(row=row_idx, column=c).border = thin_border

        # ----------------------------------------------------
        # SHEET 2: Room Breakdown Matrix (Jeffway Spec Step 1.3)
        # ----------------------------------------------------
        ws2 = wb.create_sheet(title="Room Matrix")
        ws2.views.sheetView[0].showGridLines = True
        
        ws2["A1"] = f"ROOM-BY-ROOM ELECTRICAL SCHEDULE - {project_name}"
        ws2["A1"].font = title_font
        
        # Standard rooms
        rooms = [
            "Living Room", "Kitchen", "Dining", "Hall / Stairs", 
            "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bathroom", "En-suite", "WC", "Loft / Roof Space"
        ]
        
        ws2.cell(row=3, column=1, value="Room / Area").font = header_font
        ws2.cell(row=3, column=1).fill = header_fill
        ws2.cell(row=3, column=1).alignment = left_align

        for col_idx, leg in enumerate(legends, 2):
            c = ws2.cell(row=3, column=col_idx, value=leg.get("label"))
            c.font = header_font
            c.fill = header_fill
            c.alignment = center_align

        c_tot = ws2.cell(row=3, column=len(legends) + 2, value="Total per Room")
        c_tot.font = header_font
        c_tot.fill = header_fill
        c_tot.alignment = center_align

        # Populate rooms
        r_row = 4
        for r_name in rooms:
            ws2.cell(row=r_row, column=1, value=r_name).font = bold_font
            ws2.cell(row=r_row, column=1).border = thin_border
            
            # Count per legend in this room
            room_sum = 0
            for col_idx, leg in enumerate(legends, 2):
                lid = leg["legend_id"]
                # Match room tag (case insensitive substring)
                count_in_room = sum(
                    1 for m in markers 
                    if m.get("legend_id") == lid and r_name.lower() in m.get("room", "").lower()
                )
                cell = ws2.cell(row=r_row, column=col_idx, value=count_in_room)
                cell.alignment = center_align
                cell.border = thin_border
                room_sum += count_in_room
            
            tot_cell = ws2.cell(row=r_row, column=len(legends) + 2, value=room_sum)
            tot_cell.font = bold_font
            tot_cell.alignment = center_align
            tot_cell.border = thin_border
            tot_cell.fill = subhead_fill
            r_row += 1

        # Totals row for room matrix
        ws2.cell(row=r_row, column=1, value="Totals").font = bold_font
        ws2.cell(row=r_row, column=1).fill = subhead_fill
        ws2.cell(row=r_row, column=1).border = thin_border
        for col_idx, leg in enumerate(legends, 2):
            col_letter = get_column_letter(col_idx)
            c = ws2.cell(row=r_row, column=col_idx, value=f"=SUM({col_letter}4:{col_letter}{r_row-1})")
            c.font = bold_font
            c.alignment = center_align
            c.fill = subhead_fill
            c.border = thin_border
        
        last_letter = get_column_letter(len(legends) + 2)
        grand_tot = ws2.cell(row=r_row, column=len(legends) + 2, value=f"=SUM({last_letter}4:{last_letter}{r_row-1})")
        grand_tot.font = bold_font
        grand_tot.alignment = center_align
        grand_tot.fill = subhead_fill
        grand_tot.border = thin_border

        # ----------------------------------------------------
        # SHEET 3: Audit Trail (Complete Quality Control Ledger)
        # ----------------------------------------------------
        ws3 = wb.create_sheet(title="Audit Trail")
        ws3.views.sheetView[0].showGridLines = True
        
        ws3["A1"] = f"QUALITY CONTROL & COORDINATE AUDIT TRAIL - {project_name}"
        ws3["A1"].font = title_font
        
        headers_3 = [
            "Marker ID", "Page No", "Symbol Label", "Assigned Room", 
            "Canvas X", "Canvas Y", "Confidence Score", "Verification Status", "Timestamp"
        ]
        for col_num, h in enumerate(headers_3, 1):
            cell = ws3.cell(row=3, column=col_num, value=h)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = center_align

        for m_idx, m in enumerate(markers, 4):
            lid = m.get("legend_id")
            leg = legend_lookup.get(lid, {})
            score = m.get("confidence_score", 1.0)
            status = m.get("status", "ai_unverified")

            ws3.cell(row=m_idx, column=1, value=m.get("marker_id", f"mk_{m_idx}")).alignment = center_align
            ws3.cell(row=m_idx, column=2, value=m.get("page_number", 1)).alignment = center_align
            ws3.cell(row=m_idx, column=3, value=leg.get("label", "Unknown")).alignment = left_align
            ws3.cell(row=m_idx, column=4, value=m.get("room", "Unassigned")).alignment = left_align
            ws3.cell(row=m_idx, column=5, value=m.get("x", 0)).alignment = right_align
            ws3.cell(row=m_idx, column=6, value=m.get("y", 0)).alignment = right_align
            ws3.cell(row=m_idx, column=7, value=f"{int(score * 100)}%").alignment = center_align
            ws3.cell(row=m_idx, column=8, value=status).alignment = center_align
            ws3.cell(row=m_idx, column=9, value=datetime.now().strftime("%Y-%m-%d %H:%M")).alignment = center_align

            for c in range(1, 10):
                ws3.cell(row=m_idx, column=c).border = thin_border

        # Adjust column widths automatically
        for sheet in [ws1, ws2, ws3]:
            for col in sheet.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = get_column_letter(col[0].column)
                sheet.column_dimensions[col_letter].width = max(max_len + 3, 12)

        wb.save(str(output_path))
        return str(output_path)
