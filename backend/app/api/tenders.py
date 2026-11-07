import re
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
def upload_tender(  # sync: FastAPI runs it on a worker thread, so a big pack never blocks the other requests
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
    resume: bool = False
    api_key: Optional[str] = None


@router.post("/{tender_id}/run")
def run_tender(tender_id: str, req: RunRequest):
    if not ps.reconcile(ps.load_tender(tender_id)):
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


@router.post("/{tender_id}/reset")
def reset_tender(tender_id: str):
    """Delete every mark (approved and AI-checked too) so the next run starts from scratch."""
    try:
        t = ps.reset_tender(tender_id)
    except KeyError:
        raise HTTPException(404, "Tender not found")
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    t.get("settings", {}).pop("api_key", None)
    return t


@router.delete("/{tender_id}")
def delete_tender(tender_id: str):
    try:
        ps.delete_tender(tender_id)
    except KeyError:
        raise HTTPException(404, "Tender not found")
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@router.post("/{tender_id}/stop")
def stop(tender_id: str):
    """Stop a running takeoff after its current sheet. Everything counted so far is kept."""
    if not ps.load_tender(tender_id):
        raise HTTPException(404, "Tender not found")
    return ps.stop_run(tender_id)


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
    t = ps.reconcile(ps.load_tender(tender_id))
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


@router.get("/preview/page")
def page_preview(filepath: str, page_index: int, w: int = 900):
    """Sharp page preview at a given width, for reviewing sheets."""
    from fastapi.responses import FileResponse
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(404, "PDF not found")
    return FileResponse(PDFService.get_preview(path, page_index, w), media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


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


class ExportRequest(BaseModel):
    mode: str = "counted"  # counted: approved + AI-confirmed + unreviewed at/above threshold; approved: approved only
    threshold: float = 0.8


@router.post("/{tender_id}/export")
def export_tender(tender_id: str, r: ExportRequest):
    """The whole tender into Jeffway's workbook: every house type's counts and plots."""
    import re
    import time
    from fastapi.responses import FileResponse
    from app.core.config import EXPORTS_DIR
    from app.services.master_excel_service import MasterExcelService

    t = ps.reconcile(ps.load_tender(tender_id))
    if not t:
        raise HTTPException(404, "Tender not found")
    approved = ("user_verified", "manual_added")

    def keep(m):
        if r.mode == "approved":
            return m.get("status") in approved
        return m.get("status") in approved or m.get("status") == "ai_verified" or float(m.get("confidence_score") or 0) >= r.threshold

    houses = []
    for ht in t["house_types"]:
        st = ps.load_state(ht["project_id"])
        src = ht.get("plots_source") or {}
        houses.append({
            "name": ht["name"],
            "plots": int(ht.get("plots") or 1),
            "plot_source": f"schedule: {src.get('file')}" if src.get("file") else ("set by hand" if src.get("manual") else "default (1)"),
            "markers": [m for m in st.get("markers", []) if keep(m)],
            # for the pricing rules: a house with a roof / loft plan has a loft light spur
            "house": {"loft": any(re.search(r"(?i)roof|loft", p.get("title") or "") for p in ht.get("electrical_pages", [])),
                      "cylinder": True, "dwelling": True},
        })
    basis = (
        "Counted = approved marks only." if r.mode == "approved"
        else f"Counted = approved + AI-confirmed + unreviewed marks scoring {round(r.threshold * 100)}% or more."
    )
    if t.get("status") == "running":
        basis += " Counting was still running when this was exported."
    safe = re.sub(r"[^A-Za-z0-9 _-]+", "", t["name"]).strip()[:60] or "Tender"
    out = EXPORTS_DIR / f"{safe} - Tender workbook {time.strftime('%Y%m%d-%H%M%S')}.xlsx"
    try:
        MasterExcelService.generate_tender_workbook(houses, t["name"], out, basis=basis)
    except FileNotFoundError as e:
        raise HTTPException(500, str(e))
    return FileResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        filename=f"{safe} - Tender workbook.xlsx")
