from fastapi import APIRouter, HTTPException
from typing import Dict, List, Any
from app.services.master_excel_service import MasterExcelService

router = APIRouter()

@router.get("/library")
def get_symbol_library() -> List[Dict[str, Any]]:
    """Retrieve the master symbol catalog and sheet row mappings."""
    return MasterExcelService.load_symbol_library()

@router.post("/library")
def update_symbol_library(library: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Save updated or new symbol definitions and mappings."""
    try:
        MasterExcelService.save_symbol_library(library)
        return {"status": "success", "count": len(library)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save library: {str(e)}")
