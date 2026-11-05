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

    @classmethod
    def generate_master_tender(
        cls,
        house_type_name: str,
        markers: List[Dict[str, Any]],
        output_path: Optional[str | Path] = None
    ) -> Path:
        """
        Loads the official Jeffway 36-sheet Master Tender Excel template,
        populates the detected quantities into Column A of the specified house sheet,
        and leaves all native 1st Fix, 2nd Fix, and Tender formulas intact.
        """
        if not cls.TEMPLATE_PATH.exists():
            raise FileNotFoundError(f"Master Tender template not found at {cls.TEMPLATE_PATH}")

        # Standardize house type sheet name (e.g. 'The Avebury' -> 'Avebury')
        clean_house_type = house_type_name.replace("The ", "").strip()
        
        # Output directory
        if not output_path:
            exports_dir = BASE_DIR / "data" / "exports"
            exports_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = exports_dir / f"Jeffway_Tender_{clean_house_type}_{timestamp}.xlsx"
        else:
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

        # Load library
        library = cls.load_symbol_library()
        lib_lookup = {item["symbol_id"]: item for item in library}
        
        # Also build fallback label lookup
        label_lookup = {}
        for item in library:
            label_lookup[item["cad_label"].lower()] = item
            if item.get("cad_abbreviation"):
                label_lookup[item["cad_abbreviation"].lower()] = item

        # Tally counts by target sheet row
        row_counts: Dict[int, int] = {}
        
        for m in markers:
            # Check symbol_id first, then label / legend_id
            sym_id = m.get("symbol_id") or m.get("legend_id") or ""
            lib_entry = lib_lookup.get(sym_id)
            
            if not lib_entry:
                lbl = str(m.get("label") or "").lower().strip()
                lib_entry = label_lookup.get(lbl)
                
            if not lib_entry:
                continue

            target_row = lib_entry["sheet_row"]
            
            # Apply room zone override (e.g. Downlight in Bathroom -> IP Downlight)
            if "room_override" in lib_entry:
                room_name = str(m.get("room") or "").lower()
                override_cfg = lib_entry["room_override"]
                if any(zone in room_name for zone in override_cfg.get("zones", [])):
                    target_row = override_cfg.get("override_row", target_row)

            row_counts[target_row] = row_counts.get(target_row, 0) + 1

        # Open workbook (preserving all formulas)
        wb = openpyxl.load_workbook(str(cls.TEMPLATE_PATH), data_only=False)

        # Find exact sheet name (allowing for whitespace / variations)
        target_sheet = None
        for sname in wb.sheetnames:
            if clean_house_type.lower() in sname.lower() or sname.lower() in clean_house_type.lower():
                target_sheet = wb[sname]
                break

        if target_sheet is None:
            # Fallback to Avebury if specific sheet not found
            target_sheet = wb["Avebury"]

        # Populate Column A (Qty) in target sheet
        for r in range(10, min(140, target_sheet.max_row + 1)):
            if r in row_counts:
                target_sheet.cell(row=r, column=1, value=row_counts[r])
            # If item was recognized and has count 0, keep formula or cell clean

        # Auto-balance linked composite packages if detected
        # e.g., if Split Load Board (row 10) is detected, ensure standard protection RCBOs match
        if row_counts.get(10, 0) > 0:
            target_sheet.cell(row=12, column=1, value=1) # 40a RCBO
            target_sheet.cell(row=13, column=1, value=4) # 32a RCBO
            target_sheet.cell(row=14, column=1, value=1) # 16a RCBO
            target_sheet.cell(row=15, column=1, value=1) # 16a Type C MCB (ASHP)
            target_sheet.cell(row=16, column=1, value=4) # 6a RCBO
            target_sheet.cell(row=17, column=1, value=4) # Blank Module

        # If Grid Switch frame is present (Row 41), populate standard kitchen appliance grid modules
        if row_counts.get(41, 0) > 0:
            target_sheet.cell(row=43, column=1, value=1) # Washing Machine
            target_sheet.cell(row=44, column=1, value=1) # Dishwasher
            target_sheet.cell(row=45, column=1, value=1) # Fridge Freezer
            target_sheet.cell(row=46, column=1, value=1) # Cooker Hood

        # Save populated workbook
        wb.save(str(output_path))
        return output_path
