import base64
import hashlib
import io
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.config import DATA_DIR
from app.services.master_excel_service import MasterExcelService

router = APIRouter()
SOURCES_DIR = DATA_DIR / "symbol_sources"

# Sheets are matched at 200 dpi. A symbol on a 1:50 plan is typically 25-60 px at that resolution.
TYPICAL_SYMBOL_PX = 40


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


class NewSymbol(BaseModel):
    cad_label: str
    template_image_b64: str
    source: str = "upload"  # upload | drawing | pdf
    resize_to_px: Optional[int] = None  # uploaded pictures: longest side at 200 dpi
    sheet_row: Optional[int] = None
    sheet_desc: Optional[str] = None
    category: str = "Power & Accessories"
    fix_stage: str = "2nd Fix"
    manufacturer: str = ""
    part_code: str = ""
    unit_price: Optional[float] = None
    cable_per_point_m: Optional[float] = None
    cable_type: Optional[str] = None
    color: str = "#E8590C"
    cad_abbreviation: Optional[str] = None


def _prepare_image(b64: str, resize_to: Optional[int]) -> str:
    """Normalise to PNG on white, trim empty margins, and optionally resize (for uploaded pictures)."""
    from PIL import Image, ImageChops

    raw = b64.split(",", 1)[1] if "," in b64 else b64
    try:
        im = Image.open(io.BytesIO(base64.b64decode(raw)))
    except Exception:
        raise HTTPException(400, "That image couldn't be read. Use a PNG or JPG.")
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    im = im.convert("RGB")
    # Trim white margins so the sample is just the symbol
    diff = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255)))
    box = diff.convert("L").point(lambda p: 255 if p > 20 else 0).getbbox()
    if box:
        pad = 3
        im = im.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad)))
    if resize_to and resize_to > 0:
        k = resize_to / max(im.width, im.height)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.Resampling.LANCZOS)
    if max(im.width, im.height) < 8:
        raise HTTPException(400, "The picture is too small to use as a sample.")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@router.post("/library/add")
def add_symbol(s: NewSymbol) -> Dict[str, Any]:
    """Add a new symbol to the master library. Every future takeoff run looks for it."""
    label = s.cad_label.strip()
    if not label:
        raise HTTPException(400, "Give the symbol a name")
    lib = MasterExcelService.load_symbol_library()
    if any(str(x.get("cad_label", "")).strip().lower() == label.lower() for x in lib):
        raise HTTPException(409, f'A symbol called "{label}" is already in the library')
    base = "sym_" + (re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40] or "symbol")
    sid, n = base, 2
    ids = {x.get("symbol_id") or x.get("legend_id") for x in lib}
    while sid in ids:
        sid, n = f"{base}_{n}", n + 1
    img = _prepare_image(s.template_image_b64, s.resize_to_px if s.source == "upload" else None)
    entry: Dict[str, Any] = {
        "symbol_id": sid,
        "legend_id": sid,
        "cad_label": label,
        "label": label,
        "cad_abbreviation": s.cad_abbreviation or "",
        "sheet_row": s.sheet_row,
        "sheet_desc": s.sheet_desc or "",
        "manufacturer": s.manufacturer,
        "part_code": s.part_code,
        "unit_price": s.unit_price,
        "category": s.category,
        "fix_stage": s.fix_stage,
        "cable_per_point_m": s.cable_per_point_m,
        "cable_type": s.cable_type,
        "color": s.color,
        "template_image_b64": img,
        "template_source": s.source,
    }
    lib.append(entry)
    MasterExcelService.save_symbol_library(lib)
    try:  # the sheet classifier caches library descriptions
        from app.services import sheet_classifier
        sheet_classifier._library_tokens.cache_clear()
    except Exception:
        pass
    return entry


@router.delete("/library/{symbol_id}")
def delete_symbol(symbol_id: str) -> Dict[str, Any]:
    lib = MasterExcelService.load_symbol_library()
    keep = [x for x in lib if (x.get("symbol_id") or x.get("legend_id")) != symbol_id]
    if len(keep) == len(lib):
        raise HTTPException(404, "Symbol not found")
    MasterExcelService.save_symbol_library(keep)
    try:
        from app.services import sheet_classifier
        sheet_classifier._library_tokens.cache_clear()
    except Exception:
        pass
    return {"status": "deleted", "count": len(keep)}


@lru_cache(maxsize=1)
def _workbook_rows_cached(mtime: float) -> List[Dict[str, Any]]:
    import openpyxl

    wb = openpyxl.load_workbook(str(MasterExcelService.TEMPLATE_PATH), data_only=True, read_only=True)
    tabs = [ws for ws in wb.worksheets if str(ws.cell(1, 1).value or "").strip().lower() == "2nd fix takeoff"]
    if not tabs:
        return []
    ws = tabs[0]
    rows = []
    for r, row in enumerate(ws.iter_rows(min_row=10, max_row=160, max_col=6, values_only=True), start=10):
        desc = row[3]
        if desc and str(desc).strip() and not str(desc).startswith("="):
            rows.append({"row": r, "description": str(desc).strip(), "manufacturer": row[1] or "", "part_code": row[2] or "", "unit_price": row[4]})
    return rows


@router.get("/workbook-rows")
def workbook_rows() -> List[Dict[str, Any]]:
    """The lines on a house-type tab of Jeffway's tender workbook, for mapping a symbol to its line."""
    p = MasterExcelService.TEMPLATE_PATH
    if not p.exists():
        return []
    return _workbook_rows_cached(p.stat().st_mtime)


@router.post("/source-pdf")
async def upload_source_pdf(file: UploadFile = File(...)) -> Dict[str, Any]:
    """A PDF to crop a symbol sample from (doesn't have to be part of a tender)."""
    import fitz

    data = await file.read()
    if not data[:5] == b"%PDF-":
        raise HTTPException(400, "That isn't a PDF")
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    name = Path(file.filename or "drawing.pdf").name
    dest = SOURCES_DIR / f"{hashlib.sha1(data).hexdigest()[:10]}_{name}"
    if not dest.exists():
        dest.write_bytes(data)
    pages = []
    with fitz.open(str(dest)) as doc:
        for i, pg in enumerate(doc):
            pages.append({"page_index": i, "page_number": i + 1})
    return {"filepath": str(dest.resolve()), "name": name, "pages": pages}
