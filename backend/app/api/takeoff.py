from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, List, Any, Optional
from pathlib import Path
import json
import uuid
import numpy as np

from app.core.config import PROJECTS_DIR, CACHE_DIR
from app.services.pdf_service import PDFService
from app.vision.template_matcher import GeometricVisionMatcher

router = APIRouter()

class LegendItem(BaseModel):
    legend_id: str
    label: str
    color: str = "#EF4444"
    category: str = "Power & Accessories"
    fix_stage: str = "2nd Fix"
    manufacturer: str = "Deta"
    part_code: str = "Slimline Standard"
    template_crop_coords: Optional[Dict[str, float]] = None # {x, y, width, height}
    template_image_b64: Optional[str] = None

class AutoCountRequest(BaseModel):
    project_id: str
    filepath: str
    page_index: int
    legend: LegendItem
    dpi: int = 200
    min_confidence: float = 0.65
    angles: List[int] = [0, 90, 180, 270]
    excluded_zones: Optional[List[Dict[str, Any]]] = None

class MarkerUpdate(BaseModel):
    marker_id: str
    status: Optional[str] = None # "user_verified", "ai_unverified", "needs_review", "manual_added"
    room: Optional[str] = None
    legend_id: Optional[str] = None

class SaveStateRequest(BaseModel):
    project_id: str
    legends: List[Dict[str, Any]]
    markers: List[Dict[str, Any]]
    rooms: Optional[List[Dict[str, Any]]] = []
    excluded_zones: Optional[Dict[str, Any]] = {}

@router.get("/legend-zone")
def get_detected_legend_zone(filepath: str, page_index: int, dpi: int = 200):
    """Detect the electrical legend table zone on a blueprint page."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Blueprint PDF file not found")
    zone = PDFService.detect_legend_zone(path, page_index, dpi)
    return {"legend_zone": zone}

@router.post("/auto-count")
def run_auto_count(req: AutoCountRequest) -> Dict[str, Any]:
    """Runs high-performance geometric template matching for the given symbol crop."""
    path = Path(req.filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Blueprint PDF file not found")

    if not req.legend.template_crop_coords:
        raise HTTPException(status_code=400, detail="No template crop coordinates provided")

    # Ensure page image is rendered
    img_path, width, height = PDFService.render_page_image(path, req.page_index, req.dpi)

    # Generic Electrical Legend exclusion: use passed excluded_zones or auto-detect
    excluded_zones = req.excluded_zones
    legend_zone = None
    if not excluded_zones:
        legend_zone = PDFService.detect_legend_zone(path, req.page_index, req.dpi, req.legend.template_crop_coords)
        excluded_zones = [legend_zone] if legend_zone else []
    else:
        legend_zone = excluded_zones[0] if len(excluded_zones) > 0 else None

    # Execute geometric matcher with rotation and multi-scale
    found_markers = GeometricVisionMatcher.match_symbol(
        full_image_path=str(img_path),
        template_crop_coords=req.legend.template_crop_coords,
        legend_id=req.legend.legend_id,
        scales=[0.9, 1.0, 1.1],
        angles=req.angles,
        min_confidence=req.min_confidence,
        exclude_source_box=True,
        excluded_zones=excluded_zones
    )

    # Attach page index
    for m in found_markers:
        m["page_index"] = req.page_index
        m["page_number"] = req.page_index + 1

    return {
        "legend_id": req.legend.legend_id,
        "total_detected": len(found_markers),
        "markers": found_markers,
        "legend_zone": legend_zone
    }

@router.post("/save-state")
def save_project_state(req: SaveStateRequest):
    """Persist legends, markers, rooms, and exclusion zones for a project."""
    p_dir = PROJECTS_DIR / req.project_id
    p_dir.mkdir(parents=True, exist_ok=True)
    
    state_path = p_dir / "state.json"
    with open(state_path, "w") as f:
        json.dump({
            "legends": req.legends,
            "markers": req.markers,
            "rooms": req.rooms,
            "excluded_zones": req.excluded_zones
        }, f, indent=2)
        
    return {"status": "success", "saved_markers": len(req.markers)}

class VerifyCandidatesRequest(BaseModel):
    filepath: str
    page_index: int
    legend: LegendItem
    markers: List[Dict[str, Any]]
    api_key: Optional[str] = None
    all_legends: Optional[List[LegendItem]] = None
    excluded_zones: Optional[List[Dict[str, Any]]] = None

@router.post("/verify-candidates-ai")
def verify_candidates_ai(req: VerifyCandidatesRequest):
    """
    Stage 2 AI Vision: Takes detected candidate patches and validates them with GPT-4o Vision.
    Extracts standardized canonical square macro-windows to capture rotated symbols and modifier text.
    """
    from PIL import Image
    import io
    import base64
    from app.services.openai_service import OpenAIService

    path = Path(req.filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    img_path, width, height = PDFService.render_page_image(path, req.page_index, dpi=200)
    full_img = Image.open(img_path)

    # Save temporary template image if not on disk
    temp_dir = CACHE_DIR / "templates"
    temp_dir.mkdir(exist_ok=True)
    tpl_path = temp_dir / f"{req.legend.legend_id}.png"

    if req.legend.template_crop_coords:
        tc = req.legend.template_crop_coords
        tpl_crop = full_img.crop((tc["x"], tc["y"], tc["x"] + tc["width"], tc["y"] + tc["height"]))
        # Also ensure template is rendered at crisp resolution
        if tpl_crop.width < 120 or tpl_crop.height < 120:
            tpl_crop = tpl_crop.resize((max(120, tpl_crop.width * 2), max(120, tpl_crop.height * 2)), Image.Resampling.LANCZOS)
        tpl_crop.save(tpl_path)
    elif req.legend.template_image_b64:
        header, encoded = req.legend.template_image_b64.split(",", 1)
        data = base64.b64decode(encoded)
        with open(tpl_path, "wb") as f:
            f.write(data)
    else:
        raise HTTPException(status_code=400, detail="No reference template available for AI verification")

    # Detect printed legend table to exclude any candidate markers inside it
    excluded_zones = req.excluded_zones
    if not excluded_zones:
        try:
            lz = PDFService.detect_legend_zone(
                path, 
                req.page_index, 
                dpi=200, 
                template_crop_coords=req.legend.template_crop_coords
            )
            if lz:
                excluded_zones = [lz]
        except Exception as e:
            print(f"Legend zone detection skipped in AI verification: {e}")

    valid_markers = []
    for m in req.markers:
        mx = float(m.get("x", 0))
        my = float(m.get("y", 0))
        mw = float(m.get("width", 30))
        mh = float(m.get("height", 30))
        cx = mx + mw / 2.0
        cy = my + mh / 2.0
        if excluded_zones:
            in_excluded = False
            for ez in excluded_zones:
                ex = float(ez.get("x", 0))
                ey = float(ez.get("y", 0))
                ew = float(ez.get("width", 0))
                eh = float(ez.get("height", 0))
                if (ex <= cx <= ex + ew) and (ey <= cy <= ey + eh):
                    in_excluded = True
                    break
            if in_excluded:
                print(f"Skipping candidate marker {m.get('marker_id')} as it falls within an excluded zone.")
                continue
        valid_markers.append(m)

    if not valid_markers:
        return {"verifications": []}

    # Reference template dimensions
    tpl_w = req.legend.template_crop_coords.get("width", 30) if req.legend.template_crop_coords else 30
    tpl_h = req.legend.template_crop_coords.get("height", 30) if req.legend.template_crop_coords else 30
    tpl_max_dim = max(tpl_w, tpl_h)

    # Layer 2: Pre-Flight AI Spatial Deduplication
    # Eliminates twin-lobe harmonics and multi-angle duplicates (e.g. 13A double sockets detected at both lobes)
    # BEFORE calling OpenAI, preventing duplicate API costs and inflated counts.
    valid_markers.sort(key=lambda m: float(m.get("confidence_score", 0)), reverse=True)
    deduped_markers = []
    for m in valid_markers:
        mx = float(m.get("x", 0))
        my = float(m.get("y", 0))
        mw = float(m.get("width", 30))
        mh = float(m.get("height", 30))
        mcx = mx + mw / 2.0
        mcy = my + mh / 2.0

        is_duplicate = False
        for accepted in deduped_markers:
            ax = float(accepted.get("x", 0))
            ay = float(accepted.get("y", 0))
            aw = float(accepted.get("width", 30))
            ah = float(accepted.get("height", 30))
            acx = ax + aw / 2.0
            acy = ay + ah / 2.0

            # Intersection over minimum box area on canvas
            ix1 = max(mx, ax)
            iy1 = max(my, ay)
            ix2 = min(mx + mw, ax + aw)
            iy2 = min(my + mh, ay + ah)
            inter_w = max(0.0, ix2 - ix1)
            inter_h = max(0.0, iy2 - iy1)
            inter_area = inter_w * inter_h
            min_area = min(mw * mh, aw * ah)
            overlap_ratio = inter_area / max(1.0, min_area)

            # Euclidean center distance
            dist = np.sqrt((mcx - acx) ** 2 + (mcy - acy) ** 2)
            max_symbol_dim = max(mw, mh, aw, ah, tpl_max_dim)
            dist_threshold = 0.75 * max_symbol_dim

            # Major-axis spatial deduplication: merge if overlap >= 30% OR center distance < 75% of symbol major dimension
            if overlap_ratio >= 0.30 or dist < dist_threshold:
                is_duplicate = True
                print(f"Layer 2 Deduplication: Skipped duplicate candidate {m.get('marker_id')} ({m.get('confidence_score')}) absorbed by {accepted.get('marker_id')} ({accepted.get('confidence_score')}) at distance {dist:.1f}px")
                break

        if not is_duplicate:
            deduped_markers.append(m)

    valid_markers = deduped_markers

    candidate_patches = []
    for m in valid_markers:
        mx = float(m.get("x", 0))
        my = float(m.get("y", 0))
        mw = float(m.get("width", tpl_w))
        mh = float(m.get("height", tpl_h))

        center_x = int(mx + mw / 2.0)
        center_y = int(my + mh / 2.0)

        # Frame slightly larger than the identified circle (~30% padding, 8-10px beyond circle boundary)
        # Prevents bleeding into adjacent rows/symbols while giving full symbol context
        circle_radius = max(16, int(round(max(mw, mh) / 2.0)) + 3)
        crop_padding = max(8, int(round(circle_radius * 0.32)))
        half_box = circle_radius + crop_padding

        cx1 = max(0, center_x - half_box)
        cy1 = max(0, center_y - half_box)
        cx2 = min(width, center_x + half_box)
        cy2 = min(height, center_y + half_box)

        patch = full_img.crop((cx1, cy1, cx2, cy2))

        # Sharp Lanczos upscaling if small so fine text strokes (e.g. 'USB') are easily readable by GPT-4o
        if patch.width < 160 or patch.height < 160:
            target_w = max(160, patch.width * 2)
            target_h = max(160, patch.height * 2)
            patch = patch.resize((target_w, target_h), Image.Resampling.LANCZOS)

        # Standardize candidate patch orientation using 1st-pass geometric matcher detected angle.
        # De-rotating wall-mounted symbols back to standard 0° upright orientation eliminates
        # LLM rotational blindness, ensuring symbols on vertical walls match the template directly.
        angle = int(m.get("angle", 0))
        if angle == 90:
            patch = patch.transpose(Image.Transpose.ROTATE_90)
        elif angle == 180:
            patch = patch.transpose(Image.Transpose.ROTATE_180)
        elif angle == 270:
            patch = patch.transpose(Image.Transpose.ROTATE_270)

        buffered = io.BytesIO()
        patch.save(buffered, format="PNG")
        patch_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

        candidate_patches.append({
            "marker_id": m.get("marker_id"),
            "patch_b64": patch_b64,
            "angle": angle
        })

    try:
        other_labels = []
        if req.all_legends:
            for l in req.all_legends:
                if l.legend_id != req.legend.legend_id and l.label.strip():
                    other_labels.append(l.label.strip())

        results = OpenAIService.verify_marker_patches(
            template_img_path=tpl_path,
            candidate_patches=candidate_patches,
            legend_label=req.legend.label,
            other_legends=other_labels,
            api_key=req.api_key
        )
        return {"verifications": results}
    except Exception as e:
        try:
            from app.services.audit_logger import record_audit_log
            record_audit_log(
                legend_label=req.legend.label,
                template_b64="",
                candidates=[{"marker_id": c["marker_id"], "patch_b64": c["patch_b64"], "index": i + 1} for i, c in enumerate(candidate_patches[:8])],
                prompt_text=f"AI Vision Audit failed with exception:\n{str(e)}",
                raw_response=json.dumps({"error": str(e)}, indent=2),
                verifications=[{"marker_id": c["marker_id"], "is_valid": False, "confidence": 0.0, "reason": f"Audit Error: {str(e)}"} for c in candidate_patches[:8]],
                model_used="gpt-4o (Error)"
            )
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/audit-logs")
def get_ai_audit_logs():
    """Returns the history of AI second-pass runs with exact images sent, prompts, and raw responses."""
    from app.services.audit_logger import get_audit_logs
    return {"logs": get_audit_logs()}

@router.post("/clear-audit-logs")
def clear_ai_audit_logs():
    from app.services.audit_logger import clear_audit_logs
    clear_audit_logs()
    return {"status": "success"}
