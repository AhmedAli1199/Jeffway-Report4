from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from typing import Dict, List, Any, Optional
from pathlib import Path
import shutil
import json
import uuid

from app.core.config import PROJECTS_DIR, BASE_DIR, DATA_DIR
from app.services.pdf_service import PDFService
from app.services.master_excel_service import MasterExcelService

router = APIRouter()

# Auto-discover the sample Avebury PDF if available in the workspace
def get_sample_files() -> List[Path]:
    sample_paths = []
    # Check Curo tender docs
    curo_folder = BASE_DIR.parent / "Curo Tender Docs for AI"
    if curo_folder.exists():
        for pdf in curo_folder.rglob("*.pdf"):
            if "__MACOSX" in str(pdf) or pdf.name.startswith("._"):
                continue
            if "The Avebury" in pdf.name:
                sample_paths.append(pdf)
    # Fall back to the benchmark PDF committed in the repo
    if not sample_paths:
        committed = DATA_DIR / "sample_blueprints" / "The Avebury.pdf"
        if committed.exists():
            sample_paths.append(committed)
    return sample_paths

@router.get("/list")
def list_projects() -> List[Dict[str, Any]]:
    """List loaded projects and sample tender packs."""
    projects = []
    
    # Pre-configure The Avebury as default sample project if found
    samples = get_sample_files()
    for s in samples:
        projects.append({
            "project_id": "proj_avebury_curo",
            "name": "The Avebury (Curo Group Keynsham)",
            "filename": s.name,
            "filepath": str(s.resolve()),
            "is_sample": True,
            "description": "3B 5P Detached House Type - 28 Page Tender Pack with Full Electrical & M&E Plans"
        })

    # Also list projects created in data/projects
    for p_dir in PROJECTS_DIR.iterdir():
        if p_dir.is_dir():
            meta_file = p_dir / "project.json"
            if meta_file.exists():
                try:
                    with open(meta_file, "r") as f:
                        projects.append(json.load(f))
                except Exception:
                    pass

    return projects

@router.get("/{project_id}/details")
def get_project_details(project_id: str, filepath: Optional[str] = None) -> Dict[str, Any]:
    """Inspect PDF and return all page metadata, electrical plan flags, and saved project state."""
    target_path = None
    if filepath and Path(filepath).exists():
        target_path = Path(filepath)
    elif project_id == "proj_avebury_curo":
        samples = get_sample_files()
        if samples:
            target_path = samples[0]

    if not target_path or not target_path.exists():
        p_dir = PROJECTS_DIR / project_id
        meta_file = p_dir / "project.json"
        if meta_file.exists():
            with open(meta_file, "r") as f:
                data = json.load(f)
                target_path = Path(data.get("filepath", ""))

    if not target_path or not target_path.exists():
        raise HTTPException(status_code=404, detail="Project PDF file not found")

    # Inspect PDF structure
    inspection = PDFService.inspect_pdf(target_path)
    
    # Load any saved project state
    state_file = PROJECTS_DIR / project_id / "state.json"
    saved_state = {
        "legends": [],
        "markers": [],
        "rooms": []
    }
    if state_file.exists():
        # The locked loader: it recovers a damaged file from the last good copy instead of returning nothing
        # (an empty state here would be saved back by the workspace autosave and wipe the marks)
        from app.services.pipeline_service import load_state
        saved_state = load_state(project_id)

    return {
        "project_id": project_id,
        "name": target_path.stem,
        "filename": target_path.name,
        "filepath": str(target_path),
        "total_pages": inspection["total_pages"],
        "pages": inspection["pages"],
        "legends": saved_state.get("legends") or MasterExcelService.load_symbol_library(),
        "markers": saved_state.get("markers", []),
        "rooms": saved_state.get("rooms", []),
        "excluded_zones": saved_state.get("excluded_zones", {})
    }

@router.get("/page-image")
def get_page_image(filepath: str, page_index: int, dpi: int = 200):
    """Renders and streams high-resolution PNG image of the requested page."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    
    img_path, width, height = PDFService.render_page_image(path, page_index, dpi)
    return FileResponse(
        img_path, 
        media_type="image/png",
        headers={"X-Image-Width": str(width), "X-Image-Height": str(height)}
    )

@router.get("/thumbnail")
def get_thumbnail(filepath: str, page_index: int):
    """Renders and streams lightweight page thumbnail."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    
    thumb_path = PDFService.get_thumbnail(path, page_index)
    return FileResponse(thumb_path, media_type="image/jpeg")

@router.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Upload a new tender PDF pack."""
    proj_id = f"proj_{uuid.uuid4().hex[:8]}"
    proj_dir = PROJECTS_DIR / proj_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = proj_dir / file.filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    meta = {
        "project_id": proj_id,
        "name": file.filename.replace(".pdf", ""),
        "filename": file.filename,
        "filepath": str(file_path),
        "is_sample": False
    }
    with open(proj_dir / "project.json", "w") as f:
        json.dump(meta, f, indent=2)
        
    return meta
