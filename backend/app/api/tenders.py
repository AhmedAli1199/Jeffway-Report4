import io
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel

from app.services import pipeline_service as ps
from app.services.pdf_service import PDFService

router = APIRouter()


@router.get("")
def list_tenders():
    return ps.list_tenders()


@router.post("/upload")
async def upload_tender(
    files: List[UploadFile] = File(...),
    paths: Optional[List[str]] = Form(None),
    name: Optional[str] = Form(None),
):
    """Upload a tender pack: a folder (with relative paths), a zip, or loose PDFs."""
    if not files:
        raise HTTPException(400, "No files uploaded")
    rels = paths if paths and len(paths) == len(files) else [f.filename or "file" for f in files]
    if not name:
        first = rels[0].replace("\\", "/")
        name = first.split("/")[0] if "/" in first else Path(first).stem
    t = ps.create_tender(name, [(r, f.file) for r, f in zip(rels, files)])
    return t


class RunRequest(BaseModel):
    use_ai: bool = True
    ai_mode: str = "manual"
    auto_high: float = 0.85
    ai_low: float = 0.60
    min_keep: float = 0.55
    max_ai_marks: int = 400
    quick: bool = False
    api_key: Optional[str] = None


@router.post("/{tender_id}/run")
def run_tender(tender_id: str, req: RunRequest):
    if not ps.load_tender(tender_id):
        raise HTTPException(404, "Tender not found")
    try:
        t = ps.start_run(tender_id, req.model_dump())
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return t


class AIRequest(BaseModel):
    ai_low: float = 0.60
    auto_high: float = 0.85
    max_ai_marks: int = 0
    api_key: Optional[str] = None
    project_ids: Optional[List[str]] = None
    legend_ids: Optional[List[str]] = None


@router.post("/{tender_id}/ai-estimate")
def ai_estimate(tender_id: str, r: AIRequest):
    if not ps.load_tender(tender_id):
        raise HTTPException(404, "Tender not found")
    return ps.estimate_ai(tender_id, r.ai_low, r.auto_high, r.max_ai_marks, r.project_ids, r.legend_ids)


@router.post("/{tender_id}/ai-run")
def ai_run(tender_id: str, r: AIRequest):
    if not ps.load_tender(tender_id):
        raise HTTPException(404, "Tender not found")
    try:
        return ps.start_ai_run(
            tender_id,
            {"ai_low": r.ai_low, "auto_high": r.auto_high, "max_ai_marks": r.max_ai_marks, "api_key": r.api_key, "use_ai": True},
            r.project_ids,
            r.legend_ids,
        )
    except RuntimeError as e:
        raise HTTPException(409, str(e))


class Sheets(BaseModel):
    rel_path: str
    page_indexes: List[int]


@router.post("/{tender_id}/sheets")
def set_sheets(tender_id: str, s: Sheets):
    """Choose which pages of a PDF in the pack are counted."""
    try:
        return ps.set_sheets(tender_id, s.rel_path, s.page_indexes)
    except KeyError:
        raise HTTPException(404, "Tender or file not found")


@router.post("/{tender_id}/schedule")
async def upload_schedule(tender_id: str, file: UploadFile = File(...)):
    if not ps.load_tender(tender_id):
        raise HTTPException(404, "Tender not found")
    try:
        return ps.apply_schedule_file(tender_id, file.filename or "schedule.xlsx", file.file)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{tender_id}")
def get_tender(tender_id: str):
    t = ps.load_tender(tender_id)
    if not t:
        raise HTTPException(404, "Tender not found")
    t.get("settings", {}).pop("api_key", None)
    return t


@router.get("/{tender_id}/marks")
def get_marks(tender_id: str):
    try:
        return ps.tender_marks(tender_id)
    except KeyError:
        raise HTTPException(404, "Tender not found")


class Decision(BaseModel):
    project_id: str
    marker_id: str
    action: str  # approve | reject | restore
    marker: Optional[Dict[str, Any]] = None


@router.post("/{tender_id}/decision")
def decide(tender_id: str, d: Decision):
    try:
        return ps.apply_decision(d.project_id, d.marker_id, d.action, d.marker)
    except ValueError as e:
        raise HTTPException(400, str(e))


class BulkApprove(BaseModel):
    project_ids: List[str]
    marker_ids: List[str]


@router.post("/{tender_id}/approve-many")
def approve_many(tender_id: str, b: BulkApprove):
    return {"approved": ps.bulk_approve(b.project_ids, b.marker_ids)}


class Plots(BaseModel):
    project_id: str
    plots: int


@router.post("/{tender_id}/plots")
def plots(tender_id: str, p: Plots):
    return ps.set_plots(tender_id, p.project_id, p.plots)


@router.get("/crop/image")
def crop(filepath: str, page_index: int, x: float, y: float, w: float, h: float, pad: float = 2.0, size: int = 360):
    """A square crop around a mark, scaled for the review queue. pad is a multiple of the mark size."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(404, "PDF not found")
    img_path, W, H = PDFService.render_page_image(path, page_index, 200)
    cx, cy = x + w / 2, y + h / 2
    half = max(w, h) * pad / 2 + 6
    box = (int(max(0, cx - half)), int(max(0, cy - half)), int(min(W, cx + half)), int(min(H, cy + half)))
    with Image.open(img_path) as im:
        c = im.convert("RGB").crop(box)
    scale = size / max(c.width, c.height)
    c = c.resize((max(1, int(c.width * scale)), max(1, int(c.height * scale))), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    c.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "max-age=86400"})


@router.get("/costs/summary")
def costs():
    from app.services import cost_ledger
    names = {t["tender_id"]: t["name"] for t in ps.list_tenders()}
    s = cost_ledger.summary(names)
    s["cost_per_call"], s["estimate_basis"] = cost_ledger.cost_per_call()
    return s
