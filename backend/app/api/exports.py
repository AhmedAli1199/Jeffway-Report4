from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict, List, Any
from pathlib import Path
import json

from app.core.config import EXPORTS_DIR
from app.services.excel_service import ExcelService
from app.services.pdf_service import PDFService

router = APIRouter()

class ExportRequest(BaseModel):
    project_id: str
    project_name: str
    filepath: str
    legends: List[Dict[str, Any]]
    markers: List[Dict[str, Any]]

@router.post("/excel")
def export_excel(req: ExportRequest):
    """Generate and return 3-tab audit-ready Excel workbook."""
    out_file = EXPORTS_DIR / f"{req.project_id}_takeoff_schedule.xlsx"
    ExcelService.generate_takeoff_spreadsheet(
        project_name=req.project_name,
        filename=Path(req.filepath).name,
        legends=req.legends,
        markers=req.markers,
        output_path=out_file
    )
    return FileResponse(
        out_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"{req.project_name}_Jeffway_Takeoff.xlsx"
    )

@router.post("/master-tender")
def export_master_tender(req: ExportRequest):
    """Generate and return official Jeffway 36-sheet Master Tender Excel workbook."""
    from app.services.master_excel_service import MasterExcelService
    
    clean_name = req.project_name.replace("The ", "").strip()
    out_file = EXPORTS_DIR / f"Jeffway_Tender_{clean_name}.xlsx"
    
    try:
        exported_path = MasterExcelService.generate_master_tender(
            house_type_name=req.project_name,
            markers=req.markers,
            output_path=out_file
        )
        return FileResponse(
            exported_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=f"Jeffway_Master_Tender_{clean_name}.xlsx"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate master tender: {str(e)}")

@router.post("/pdf")
def export_annotated_pdf(req: ExportRequest):
    """Generate and return layered vector PDF with color overlays and count badges."""
    source = Path(req.filepath)
    if not source.exists():
        raise HTTPException(status_code=404, detail="Original source PDF not found")
        
    out_file = EXPORTS_DIR / f"{req.project_id}_annotated_drawing.pdf"
    
    # Group markers by page_index
    by_page = {}
    for m in req.markers:
        pidx = m.get("page_index", 0)
        if pidx not in by_page:
            by_page[pidx] = []
        by_page[pidx].append(m)

    legends_map = {leg["legend_id"]: leg for leg in req.legends}

    PDFService.export_annotated_pdf(
        source_pdf=source,
        output_pdf=out_file,
        markers_by_page=by_page,
        legends_map=legends_map,
        image_dpi=200
    )

    return FileResponse(
        out_file,
        media_type="application/pdf",
        filename=f"{req.project_name}_Marked_Up.pdf"
    )
