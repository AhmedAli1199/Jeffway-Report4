from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
from pathlib import Path
import os

from app.core.config import settings
from app.services.pdf_service import PDFService
from app.services.openai_service import OpenAIService

router = APIRouter()

class LegendScanRequest(BaseModel):
    filepath: str
    page_index: int
    crop_coords: Optional[Dict[str, float]] = None
    api_key: Optional[str] = None

class RoomDetectRequest(BaseModel):
    filepath: str
    page_index: int
    api_key: Optional[str] = None

@router.post("/scan-legend")
def scan_legend_ai(req: LegendScanRequest):
    """Uses GPT-4o Vision to read the legend section and extract structured electrical symbols."""
    path = Path(req.filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
        
    img_path, _, _ = PDFService.render_page_image(path, req.page_index, dpi=200)
    
    try:
        symbols = OpenAIService.analyze_legend_box(img_path, req.api_key)
        return {"symbols": symbols}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/detect-rooms")
def detect_rooms_ai(req: RoomDetectRequest):
    """Uses GPT-4o Vision to identify room boundaries on the floor plan."""
    path = Path(req.filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
        
    img_path, width, height = PDFService.render_page_image(path, req.page_index, dpi=200)
    
    try:
        raw_rooms = OpenAIService.detect_room_zones(img_path, req.api_key)
        # Convert percentages to image coordinates
        formatted_rooms = []
        for r in raw_rooms:
            box = r.get("box", [0, 0, 100, 100])
            min_x = (box[0] / 100.0) * width
            min_y = (box[1] / 100.0) * height
            max_x = (box[2] / 100.0) * width
            max_y = (box[3] / 100.0) * height
            formatted_rooms.append({
                "name": r.get("name", "Room"),
                "x": min_x,
                "y": min_y,
                "width": max_x - min_x,
                "height": max_y - min_y
            })
        return {"rooms": formatted_rooms}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
