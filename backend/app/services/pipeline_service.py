"""
End-to-end tender pipeline.

Upload a tender pack (folder, zip or loose PDFs) -> find house-type drawings and their
electrical sheets -> first pass: every library symbol on every electrical sheet ->
cross-symbol de-duplication -> optional AI second pass on the borderline band only ->
one project (state.json) per house type, ready for the review queue.

Confidence bands (all configurable per run):
    score >= auto_high              strong first-pass match, no AI spend      status "ai_unverified"
    ai_low <= score < auto_high     borderline: sent to AI (if enabled)       status "needs_review" -> "ai_verified" or removed
    min_keep <= score < ai_low      weak: kept but hidden by default           status "needs_review"
    score < min_keep                dropped
"""
from __future__ import annotations

import base64
import json
import shutil
import threading
import time
import traceback
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

from app.core.config import DATA_DIR, PROJECTS_DIR
from app.services.pdf_service import PDFService
from app.services.master_excel_service import MasterExcelService
from app.vision.template_matcher import GeometricVisionMatcher

TENDERS_DIR = DATA_DIR / "tenders"
TENDERS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS = {
    "use_ai": True,
    "ai_mode": "manual",  # auto: AI runs right after the first pass; manual: you start it from the overview
    "auto_high": 0.85,
    "ai_low": 0.60,
    "min_keep": 0.55,
    "max_ai_marks": 400,
    "quick": False,
    "resume": False,  # continue a stopped run: skip sheets already counted
    "api_key": None,
}

_lock = threading.RLock()
_running: Dict[str, threading.Thread] = {}


# ---------------------------------------------------------------- storage

def _tender_path(tid: str) -> Path:
    return TENDERS_DIR / tid / "tender.json"


def load_tender(tid: str) -> Optional[Dict[str, Any]]:
    p = _tender_path(tid)
    with _lock:
        try:
            with open(p, "r") as f:
                return json.load(f)
        except FileNotFoundError:
            return None  # e.g. a folder Windows couldn't fully delete
        except json.JSONDecodeError as e:
            print(f"[pipeline] tender file {p} unreadable: {e}")
            return None


def save_tender(t: Dict[str, Any]) -> None:
    p = _tender_path(t["tender_id"])
    p.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        tmp = p.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(t, f, indent=2)
        tmp.replace(p)


def update_tender(tid: str, **patch: Any) -> Dict[str, Any]:
    with _lock:
        t = load_tender(tid) or {}
        t.update(patch)
        save_tender(t)
        return t


def reconcile(t: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """A run marked 'running' with no live thread was cut off (e.g. the backend was restarted). Say so."""
    if not t:
        return t
    tid = t["tender_id"]
    changed = False
    th = _running.get(tid)
    if t.get("status") == "running" and not (th and th.is_alive()):
        states = t.get("sheet_state") or {}
        n_done = sum(1 for v in states.values() if v == "done")
        t["status"] = "done" if n_done else "uploaded"
        prog = dict(t.get("progress") or {})
        prog.update({
            "stage": "done", "stopped": True, "interrupted": True, "sheets_done": n_done,
            "sheets_total": prog.get("sheets_total") or len(states),
            "message": f"Interrupted after {n_done} of {prog.get('sheets_total') or len(states)} sheets (the backend stopped). Continue to count the rest.",
        })
        t["progress"] = prog
        t["cancel"] = False
        for k, v in states.items():
            if v == "running":
                states[k] = "pending"
        changed = True
    sth = _running.get(f"{tid}#scan")
    if t.get("status") == "scanning" and not (sth and sth.is_alive()):
        start_scan(tid)  # the backend restarted while reading the pack: read it again
    ai = t.get("ai_progress") or {}
    ath = _running.get(f"{tid}#ai")
    if ai.get("running") and not (ath and ath.is_alive()):
        t["ai_progress"] = {**ai, "running": False, "failed": True, "message": "AI check was interrupted (the backend stopped). Run it again: marks already checked won't be re-sent."}
        changed = True
    if changed:
        save_tender(t)
    return t


def list_tenders() -> List[Dict[str, Any]]:
    out = []
    dirs = [d for d in TENDERS_DIR.iterdir() if d.is_dir() and not d.name.startswith("_deleted_")]
    for d in sorted(dirs, key=lambda p: p.stat().st_mtime, reverse=True):
        t = reconcile(load_tender(d.name))
        if t:
            t.get("settings", {}).pop("api_key", None)
            out.append(t)
    return out


def load_state(project_id: str) -> Dict[str, Any]:
    p = PROJECTS_DIR / project_id / "state.json"
    empty = {"legends": [], "markers": [], "rooms": [], "excluded_zones": {}}
    with _lock:
        if not p.exists():
            return empty
        try:
            with open(p, "r") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            # A damaged file (e.g. two writers at once): fall back to the last good copy and set the bad one aside
            bad = p.with_name(f"state.corrupt-{int(time.time())}.json")
            print(f"[pipeline] {p} unreadable ({e}); kept as {bad.name}")
            try:
                p.replace(bad)
            except OSError:
                pass
            bak = p.with_suffix(".bak")
            if bak.exists():
                try:
                    with open(bak) as f:
                        st = json.load(f)
                    save_state(project_id, st)
                    return st
                except Exception:
                    pass
            return empty


def save_state(project_id: str, state: Dict[str, Any]) -> None:
    p = PROJECTS_DIR / project_id / "state.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        tmp = p.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(state, f, indent=2)
        if p.exists():
            try:  # last good copy, for load_state to fall back on
                shutil.copyfile(p, p.with_suffix(".bak"))
            except OSError:
                pass
        tmp.replace(p)


# ---------------------------------------------------------------- upload

def _safe_rel(name: str) -> Path:
    parts = [p for p in Path(name.replace("\\", "/")).parts if p not in ("", ".", "..", "/")]
    return Path(*parts) if parts else Path("file")


def create_tender(name: str, files: List[tuple]) -> Dict[str, Any]:
    """files: list of (relative_path, fileobj)."""
    tid = f"tdr_{uuid.uuid4().hex[:8]}"
    pack = TENDERS_DIR / tid / "pack"
    pack.mkdir(parents=True, exist_ok=True)
    for rel, fobj in files:
        dest = pack / _safe_rel(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb") as out:
            shutil.copyfileobj(fobj, out)
        if dest.suffix.lower() == ".zip":
            with zipfile.ZipFile(dest) as z:
                for member in z.infolist():
                    if member.is_dir():
                        continue
                    target = pack / dest.stem / _safe_rel(member.filename)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(member) as src, open(target, "wb") as out:
                        shutil.copyfileobj(src, out)
            dest.unlink()

    tender = {
        "tender_id": tid,
        "name": name or "Tender pack",
        "created_at": time.strftime("%Y-%m-%d %H:%M"),
        "status": "uploaded",
        "house_types": [],
        "documents": [],
        "progress": {"stage": "uploaded", "message": "Ready to run", "done": 0, "total": 0},
        "summary": None,
        "settings": dict(DEFAULT_SETTINGS),
    }
    tender["status"] = "scanning"
    tender["progress"] = {"stage": "scanning", "message": "Reading the pack…", "done": 0, "total": 0}
    save_tender(tender)
    start_scan(tid)
    return load_tender(tid)


def start_scan(tid: str) -> None:
    """Read the pack (which PDFs are house types, which sheets are electrical) on a background thread."""
    key = f"{tid}#scan"
    th = _running.get(key)
    if th and th.is_alive():
        return

    def work():
        try:
            scan_pack(tid)
            update_tender(tid, status="uploaded",
                          progress={"stage": "uploaded", "message": "Ready to run", "done": 0, "total": 0})
        except Exception as e:
            traceback.print_exc()
            update_tender(tid, status="failed", progress={"stage": "failed", "message": f"Couldn't read the pack: {e}"})

    th = threading.Thread(target=work, daemon=True)
    _running[key] = th
    th.start()


def refresh_sheet_choice(tid: str) -> int:
    """Re-read which sheets count with the current sheet rules (e.g. Roof M&E plans now count), for every house
    type whose sheets nobody picked by hand. Returns the number of house types whose sheets changed."""
    changed = 0
    with _lock:
        t = load_tender(tid)
        if not t:
            return 0
        for ht in t.get("house_types", []):
            if ht.get("sheets_set_by_hand"):
                continue
            # tenders from before the flag: sheets that differ from what the classifier picked at upload were hand-picked
            picked_then = [p["page_index"] for p in (ht.get("sheets") or []) if p.get("verdict") == "yes"]
            if ht.get("sheets") and picked_then != [p["page_index"] for p in ht.get("electrical_pages", [])]:
                continue
            try:
                info = PDFService.inspect_pdf(Path(ht["filepath"]))
            except Exception:
                continue
            elec = [{"page_index": p["page_index"], "page_number": p["page_number"], "title": p.get("title", "")}
                    for p in info["pages"] if p.get("is_electrical")]
            if elec and [p["page_index"] for p in elec] != [p["page_index"] for p in ht.get("electrical_pages", [])]:
                ht["electrical_pages"] = elec
                ht["sheets"] = [{
                    "page_index": p["page_index"], "page_number": p["page_number"], "title": p.get("title", ""),
                    "verdict": (p.get("evidence") or {}).get("verdict", "yes" if p.get("is_electrical") else "no"),
                    "legend_hits": (p.get("evidence") or {}).get("legend_hits", 0),
                    "reasons": (p.get("evidence") or {}).get("reasons", []),
                } for p in info["pages"]]
                changed += 1
        if changed:
            save_tender(t)
    return changed


def scan_pack(tid: str) -> None:
    """Sort the pack's PDFs into house-type drawings (have electrical sheets) and other documents."""
    pack = TENDERS_DIR / tid / "pack"
    house_types, documents = [], []
    files = [f for f in sorted(pack.rglob("*")) if f.is_file() and "__MACOSX" not in f.parts and not f.name.startswith("._")]
    n_pdf = sum(1 for f in files if f.suffix.lower() == ".pdf")
    seen = 0
    for pdf in files:
        if pdf.suffix.lower() == ".pdf":
            seen += 1
            _progress(tid, stage="scanning", done=seen - 1, total=n_pdf, message=f"Reading {pdf.name} ({seen} of {n_pdf})")
        if not pdf.is_file() or "__MACOSX" in pdf.parts or pdf.name.startswith("._"):
            continue
        rel = str(pdf.relative_to(pack))
        if pdf.suffix.lower() != ".pdf":
            documents.append({"path": rel, "kind": pdf.suffix.lower().lstrip(".") or "file"})
            continue
        try:
            info = PDFService.inspect_pdf(pdf)
        except Exception as e:  # unreadable PDF
            documents.append({"path": rel, "kind": "pdf", "error": str(e)})
            continue
        elec = [p for p in info["pages"] if p.get("is_electrical")]
        all_pages = [
            {
                "page_index": p["page_index"],
                "page_number": p["page_number"],
                "title": p.get("title", ""),
                "verdict": (p.get("evidence") or {}).get("verdict", "yes" if p.get("is_electrical") else "no"),
                "legend_hits": (p.get("evidence") or {}).get("legend_hits", 0),
                "reasons": (p.get("evidence") or {}).get("reasons", []),
            }
            for p in info["pages"]
        ]
        if not elec:
            documents.append({
                "path": rel, "kind": "pdf", "pages": info["total_pages"], "filepath": str(pdf.resolve()),
                "sheets": all_pages, "maybe": sum(1 for p in all_pages if p["verdict"] == "maybe"),
            })
            continue
        house_types.append({
            "project_id": f"proj_{uuid.uuid4().hex[:8]}",
            "name": pdf.stem,
            "filename": pdf.name,
            "filepath": str(pdf.resolve()),
            "rel_path": rel,
            "total_pages": info["total_pages"],
            "electrical_pages": [
                {"page_index": p["page_index"], "page_number": p["page_number"], "title": p.get("title", "")}
                for p in elec
            ],
            "sheets": all_pages,
            "plots": 1,
        })
    _apply_schedule(tid, house_types, documents)
    update_tender(tid, house_types=house_types, documents=documents)


def _apply_schedule(tid: str, house_types: List[Dict[str, Any]], documents: List[Dict[str, Any]],
                    path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Find the accommodation schedule in the pack and set plots per house type from it."""
    from app.services import schedule_service as sch

    pack = TENDERS_DIR / tid / "pack"
    cands = [path] if path else sch.find_schedule(pack)
    for c in cands:
        try:
            parsed = sch.parse_schedule(c)
        except Exception as e:
            print(f"[schedule] {c.name}: {e}")
            continue
        if not parsed:
            continue
        used = set()
        for ht in house_types:
            hit = sch.plots_for(ht["name"], parsed["plots"])
            if hit:
                ht["plots"] = hit["plots"]
                ht["plots_source"] = {"file": c.name, "matched": hit["matched"]}
                used.update(hit["matched"])
            else:
                ht.setdefault("plots", 1)
                ht["plots_source"] = None
        info = {
            "file": str(c.relative_to(pack)) if pack in c.parents else c.name,
            "sheet": parsed["sheet"],
            "total": parsed["total"],
            "plots": parsed["plots"],
            "unmatched": {k: v for k, v in parsed["plots"].items() if k not in used},
        }
        with _lock:
            t = load_tender(tid) or {}
            t["schedule"] = info
            save_tender(t)
        return info
    return None


def apply_schedule_file(tid: str, filename: str, fobj) -> Dict[str, Any]:
    """A schedule uploaded separately from the pack."""
    dest = TENDERS_DIR / tid / "pack" / "_schedule" / _safe_rel(filename).name
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as out:
        shutil.copyfileobj(fobj, out)
    t = load_tender(tid)
    info = _apply_schedule(tid, t["house_types"], t["documents"], dest)
    if not info:
        raise ValueError("Couldn't find a house-type column in that file")
    t2 = load_tender(tid)
    t2["house_types"] = t["house_types"]
    save_tender(t2)
    return t2


# ---------------------------------------------------------------- pipeline

def _library_symbols() -> List[Dict[str, Any]]:
    lib = MasterExcelService.load_symbol_library()
    return [s for s in lib if s.get("template_image_b64")]


def _decode_b64(b64: str) -> Optional[np.ndarray]:
    try:
        data = b64.split(",", 1)[1] if "," in b64 else b64
        return cv2.imdecode(np.frombuffer(base64.b64decode(data), np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        return None


def _legend_from_symbol(s: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "legend_id": s.get("legend_id") or s.get("symbol_id"),
        "label": s.get("label") or s.get("cad_label") or s.get("sheet_desc") or "Symbol",
        "color": s.get("color") or "#E8590C",
        "category": s.get("category") or "Power & Accessories",
        "fix_stage": s.get("fix_stage") or "2nd Fix",
        "manufacturer": s.get("manufacturer") or "",
        "part_code": s.get("part_code") or "",
        "template_crop_coords": s.get("template_crop_coords"),
        "template_image_b64": s.get("template_image_b64"),
        "count": 0,
    }


_STOP = {"a", "an", "and", "the", "of", "to", "for", "in", "at", "on", "with", "or", "level", "-", "&", "/"}


def _tokens(s: str) -> set:
    import re
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in _STOP and len(w) > 1}


def _sheet_text_lines(pdf: Path, page_index: int, dpi: int = 200) -> List[Dict[str, Any]]:
    """Text lines on a CAD sheet, in image pixels."""
    import fitz
    k = dpi / 72.0
    lines: Dict[tuple, Dict[str, Any]] = {}
    with fitz.open(str(pdf)) as doc:
        page = doc[page_index]
        rot = page.rotation_matrix  # words come in unrotated space; the render is rotated
        for wx0, wy0, wx1, wy1, word, block, line, _ in page.get_text("words"):
            r = fitz.Rect(wx0, wy0, wx1, wy1) * rot
            x0, y0, x1, y1 = r.x0, r.y0, r.x1, r.y1
            key = (block, line)
            L = lines.setdefault(key, {"x0": x0 * k, "y0": y0 * k, "x1": x1 * k, "y1": y1 * k, "words": []})
            L["x0"], L["y0"] = min(L["x0"], x0 * k), min(L["y0"], y0 * k)
            L["x1"], L["y1"] = max(L["x1"], x1 * k), max(L["y1"], y1 * k)
            L["words"].append(word)
    out = []
    for L in lines.values():
        L["tokens"] = _tokens(" ".join(L["words"]))
        if len(L["tokens"]) >= 2 or "legend" in L["tokens"]:
            out.append(L)
    return out


def _is_legend_entry(m: Dict[str, Any], lines: List[Dict[str, Any]], label_tokens: List[set]) -> bool:
    """A legend row is a symbol with its description printed immediately to its right."""
    mx1, my0, mw, mh = m["x"] + m["width"], m["y"], m["width"], m["height"]
    mcy = my0 + mh / 2
    for L in lines:
        if not (mx1 - 0.3 * mw <= L["x0"] <= mx1 + 3.5 * max(mw, 20)):
            continue
        if not (my0 - 0.6 * mh <= (L["y0"] + L["y1"]) / 2 <= my0 + 1.6 * mh) and not (abs((L["y0"] + L["y1"]) / 2 - mcy) < mh):
            continue
        for lt in label_tokens:
            if not lt:
                continue
            common = len(L["tokens"] & lt)
            if common >= 2 and common / min(len(L["tokens"]), len(lt)) >= 0.5:
                return True
    return False


def _cross_symbol_dedupe(marks: List[Dict[str, Any]], order: Dict[str, int]) -> List[Dict[str, Any]]:
    """Where two different symbols claim the same spot, keep the stronger (ties: library order)."""
    marks = sorted(marks, key=lambda m: (-m["confidence_score"], order.get(m["legend_id"], 999)))
    kept: List[Dict[str, Any]] = []
    for m in marks:
        cx, cy = m["x"] + m["width"] / 2, m["y"] + m["height"] / 2
        r = 0.5 * max(m["width"], m["height"])
        clash = False
        for k in kept:
            kx, ky = k["x"] + k["width"] / 2, k["y"] + k["height"] / 2
            if abs(cx - kx) < max(r, 0.5 * max(k["width"], k["height"])) and abs(cy - ky) < max(r, 0.5 * max(k["width"], k["height"])):
                clash = True
                break
        if not clash:
            kept.append(m)
    return kept


def start_run(tid: str, settings: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        th = _running.get(tid)
        if th and th.is_alive():
            raise RuntimeError("This tender is already running")
        sth = _running.get(f"{tid}#scan")
        if sth and sth.is_alive():
            raise RuntimeError("Still reading the pack: try again when it has finished")
        s = dict(DEFAULT_SETTINGS)
        s.update({k: v for k, v in (settings or {}).items() if k in DEFAULT_SETTINGS})
        t = update_tender(
            tid,
            status="running",
            cancel=False,
            settings={**s, "api_key": None},
            progress={"stage": "starting", "message": "Starting…", "done": 0, "total": 0, "started_at": time.time()},
        )
        th = threading.Thread(target=_run, args=(tid, s), daemon=True)
        _running[tid] = th
        th.start()
        return t


def _progress(tid: str, **p: Any) -> None:
    with _lock:
        t = load_tender(tid)
        if not t:
            return
        prog = dict(t.get("progress") or {})
        prog.update(p)
        t["progress"] = prog
        save_tender(t)


def _run(tid: str, s: Dict[str, Any]) -> None:
    try:
        _run_inner(tid, s)
    except Exception as e:
        traceback.print_exc()
        update_tender(tid, status="failed")
        _progress(tid, stage="failed", message=f"Run failed: {e}")


def _run_inner(tid: str, s: Dict[str, Any]) -> None:
    if not s.get("resume"):
        try:
            n = refresh_sheet_choice(tid)
            if n:
                _progress(tid, message=f"Sheet choice updated for {n} house type(s) with the latest sheet rules")
        except Exception as e:
            print(f"[pipeline] sheet refresh skipped: {e}")
    t = load_tender(tid)
    if not t["house_types"]:
        _progress(tid, stage="scanning", message="Reading the tender pack…")
        scan_pack(tid)
        t = load_tender(tid)
    house_types = t["house_types"]
    if not house_types:
        update_tender(tid, status="failed")
        _progress(tid, stage="failed", message="No drawings with electrical sheets were found in this pack.")
        return

    symbols = _library_symbols()
    order = {(_legend_from_symbol(x)["legend_id"]): i for i, x in enumerate(symbols)}

    # Identical sample images (e.g. standard vs IP downlight) only need matching once
    unique: Dict[str, Dict[str, Any]] = {}
    for sym in symbols:
        key = sym["template_image_b64"]
        unique.setdefault(key, sym)
    match_syms = list(unique.values())
    templates = {id(sym): _decode_b64(sym["template_image_b64"]) for sym in match_syms}
    match_syms = [sym for sym in match_syms if templates[id(sym)] is not None]
    # Free checks after the first pass (codes, CAD layers, stroke patterns, lettered symbols, switch plates,
    # rooms), learned per tender: see services/sheet_checks.py
    from app.services.sheet_checks import TenderChecks
    checks = TenderChecks(symbols, _legend_from_symbol)

    scales = [1.0] if s.get("quick") else [0.9, 1.0, 1.1]
    legends_all = [_legend_from_symbol(x) for x in symbols]
    label_tokens = [_tokens(_legend_from_symbol(x)["label"] + " " + (x.get("sheet_desc") or "")) for x in symbols]
    label_tokens += [_tokens(x.get("cad_label") or "") for x in symbols]

    # Projects exist from the start, so the overview, review queue and AI check work while counting runs
    for ht in house_types:
        pid = ht["project_id"]
        pdir = PROJECTS_DIR / pid
        pdir.mkdir(parents=True, exist_ok=True)
        with open(pdir / "project.json", "w") as f:
            json.dump({
                "project_id": pid, "name": ht["name"], "filename": ht["filename"], "filepath": ht["filepath"],
                "is_sample": False, "tender_id": tid, "description": f"House type from {t['name']}",
            }, f, indent=2)
        with _lock:
            st = load_state(pid)
            if not st.get("legends"):
                st["legends"] = legends_all
            st.setdefault("rooms", [])
            st.setdefault("excluded_zones", {})
            save_state(pid, st)

    all_sheets = [(ht, pg) for ht in house_types for pg in ht["electrical_pages"]]
    prev = (load_tender(tid) or {}).get("sheet_state") or {}
    already = {k for k, v in prev.items() if v == "done"} if s.get("resume") else set()
    sheets = [(ht, pg) for ht, pg in all_sheets if f"{ht['project_id']}:{pg['page_index']}" not in already]
    n_sheets = len(all_sheets)
    total = len(sheets) * len(match_syms)
    sheet_state = {f"{ht['project_id']}:{pg['page_index']}": ("done" if f"{ht['project_id']}:{pg['page_index']}" in already else "pending") for ht, pg in all_sheets}
    update_tender(tid, sheet_state=sheet_state)
    _progress(tid, stage="matching", message="Finding symbols…", done=0, total=total,
              sheets_done=len(already), sheets_total=n_sheets, marks_found=0, stopped=False, interrupted=False)

    last_sheet_of = {ht["project_id"]: i for i, (ht, _) in enumerate(sheets)}
    done = 0
    found_total = 0
    legend_dropped = 0
    stopped = False
    last_report = 0.0

    with ThreadPoolExecutor(max_workers=4) as ex:
        for si, (ht, pg) in enumerate(sheets):
            if (load_tender(tid) or {}).get("cancel"):
                stopped = True
                break
            pid, page_index = ht["project_id"], pg["page_index"]
            skey = f"{pid}:{page_index}"
            label = f"{ht['name']} · {pg.get('title') or 'p.' + str(pg['page_number'])}"
            _set_sheet_state(tid, skey, "running")
            _progress(tid, current=label, message=f"{label}: rendering")

            # ---- One sheet at a time: render, find the legend area, match every symbol in parallel
            pdf = Path(ht["filepath"])
            img_path, _, _ = PDFService.render_page_image(pdf, page_index, 200)
            image = cv2.imread(str(img_path))
            zone = _trusted_legend_zone(pdf, page_index, image)

            def job(sym, image=image, zone=zone):
                return sym, GeometricVisionMatcher.match_symbol(
                    full_image_path="",
                    template_crop_coords={"x": 0, "y": 0, "width": 10, "height": 10},
                    legend_id=_legend_from_symbol(sym)["legend_id"],
                    scales=scales,
                    angles=[0, 90, 180, 270],
                    min_confidence=float(s["min_keep"]),
                    excluded_zones=[zone] if zone else None,
                    template_bgr_override=templates[id(sym)],
                    image_bgr_override=image,
                )

            marks: List[Dict[str, Any]] = []
            futures = [ex.submit(job, sym) for sym in match_syms]
            for fut in as_completed(futures):
                try:
                    sym, found = fut.result()
                except Exception as e:
                    print(f"[pipeline] match failed: {e}")
                    done += 1
                    continue
                for m in found:
                    m.update({
                        "marker_id": f"mk_{uuid.uuid4().hex[:8]}",
                        "page_index": page_index,
                        "page_number": pg["page_number"],
                        "room": "Unassigned",
                        "confidence_score": round(float(m["confidence_score"]), 3),
                    })
                marks.extend(found)
                done += 1
                if time.time() - last_report > 0.8:
                    last_report = time.time()
                    _progress(tid, done=done, total=total, message=f"{label} · {_legend_from_symbol(sym)['label']}")
            del image

            # ---- Clean this sheet and publish it to the review queue straight away
            try:
                lines = _sheet_text_lines(pdf, page_index)
            except Exception:
                lines = []
            before = len(marks)
            marks = [m for m in marks if not _is_legend_entry(m, lines, label_tokens)]
            legend_dropped += before - len(marks)
            clean = _cross_symbol_dedupe(marks, order)
            for m in clean:
                m["status"] = "ai_unverified" if m["confidence_score"] >= s["auto_high"] else "needs_review"
            for m in clean:
                m.setdefault("marker_id", f"mk_{uuid.uuid4().hex[:8]}")

            def not_legend(m, zone=zone, lines=lines):
                cx, cy = m["x"] + m["width"] / 2, m["y"] + m["height"] / 2
                if zone and zone["x"] - 5 <= cx <= zone["x"] + zone["width"] + 5 and zone["y"] - 5 <= cy <= zone["y"] + zone["height"] + 5:
                    return False
                return not _is_legend_entry(m, lines, label_tokens)

            try:
                clean = checks.run(pdf, page_index, pg["page_number"], clean, s["auto_high"], not_legend, pg.get("title") or "")
            except Exception as e:
                print(f"[pipeline] sheet checks skipped: {e}")
            added = _merge_sheet(pid, page_index, clean, zone)
            found_total += added
            _set_sheet_state(tid, skey, "done")
            # Once all of a house type's sheets are in: drop detail-sheet repeats (kitchen layout ceiling lights)
            if last_sheet_of.get(pid) == si:
                try:
                    _finish_house(pid, ht, checks)
                except Exception as e:
                    print(f"[pipeline] house finish skipped: {e}")
            _progress(tid, done=done, total=total, sheets_done=len(already) + si + 1, marks_found=found_total,
                      message=f"{label}: {added} marks ready for review", last_sheet=label)

    # ---- AI second pass on the borderline band (auto mode), over everything saved so far
    ai_stats = None
    if s.get("use_ai") and s.get("ai_mode", "auto") == "auto" and not stopped:
        ai_stats = _ai_run_core(tid, s, None, None, report=None)

    started = (load_tender(tid) or {}).get("progress", {}).get("started_at", time.time())
    done_sheets = sum(1 for v in ((load_tender(tid) or {}).get("sheet_state") or {}).values() if v == "done")
    cs = checks.stats
    layer_stats = {"confirmed": cs["layer_confirmed"] + cs["shape_confirmed"] + cs.get("letter_confirmed", 0),
                   "down": cs["layer_down"] + cs.get("detail_repeats", 0),
                   "possible_missed": cs["possible_missed"],
                   "found": cs["shape_found"] + cs.get("letter_found", 0), "gangs": cs["gangs"], "room_rule": cs["room_rule"]}
    patch = dict(status="done", legend_entries_removed=legend_dropped, cancel=False, layer_check=layer_stats, checks=cs,
                 schedule=(load_tender(tid) or {}).get("schedule"), settings={**s, "api_key": None},
                 finished_at=time.strftime("%Y-%m-%d %H:%M"), duration_s=round(time.time() - started))
    if ai_stats is not None:
        patch["ai"] = ai_stats
    update_tender(tid, **patch)
    _progress(tid, stage="done", stopped=stopped,
              message=f"Stopped after {done_sheets} of {n_sheets} sheets" if stopped else "Takeoff ready for review",
              done=done, total=total, sheets_done=done_sheets)


KEEP_ON_RERUN = ("user_verified", "manual_added", "ai_verified")


def reset_tender(tid: str) -> Dict[str, Any]:
    """Start from scratch: delete every mark of every house type (approved, hand-added and AI-checked too),
    the AI-check history and the run progress. The pack, sheet choices and plot numbers are kept."""
    with _lock:
        t = load_tender(tid)
        if not t:
            raise KeyError(tid)
        th = _running.get(tid)
        if (th and th.is_alive()) or (_running.get(f"{tid}#ai") and _running[f"{tid}#ai"].is_alive()):
            raise RuntimeError("Stop the run (or wait for the AI check) before starting from scratch")
        for ht in t.get("house_types", []):
            st = load_state(ht["project_id"])
            st["markers"] = []
            save_state(ht["project_id"], st)
        for k in ("sheet_state", "ai_runs", "ai", "ai_progress", "summary", "layer_check", "checks",
                  "finished_at", "duration_s", "legend_entries_removed"):
            t.pop(k, None)
        t.update(status="uploaded", cancel=False,
                 progress={"stage": "uploaded", "message": "Cleared: ready to run from scratch", "done": 0, "total": 0})
        save_tender(t)
        return t


def delete_tender(tid: str) -> None:
    """Delete a tender completely: its uploaded pack, every house type's marks and its results.
    Spend already recorded in the cost ledger is kept (it was real money)."""
    with _lock:
        t = load_tender(tid)
        if not t:
            raise KeyError(tid)
        th = _running.get(tid)
        if th and th.is_alive():
            raise RuntimeError("Stop the run before deleting this tender")
        for ht in t.get("house_types", []):
            shutil.rmtree(PROJECTS_DIR / ht["project_id"], ignore_errors=True)
        d = TENDERS_DIR / tid
        shutil.rmtree(d, ignore_errors=True)
        if d.exists():  # Windows: a file still open somewhere keeps the folder; hide it, retry on next start
            try:
                d.rename(TENDERS_DIR / f"_deleted_{tid}")
            except OSError:
                try:
                    _tender_path(tid).unlink()
                except OSError:
                    pass
        _running.pop(tid, None)
        _running.pop(f"{tid}#ai", None)


def _finish_house(pid: str, ht: Dict[str, Any], checks) -> None:
    """Run the per-house checks over everything saved for this house type, then save."""
    titles = {p["page_index"]: p.get("title") or "" for p in ht["electrical_pages"]}
    with _lock:
        st = load_state(pid)
        by_page: Dict[int, List[Dict[str, Any]]] = {}
        for m in st.get("markers", []):
            by_page.setdefault(m.get("page_index"), []).append(m)
        sheets = [{"pdf": ht["filepath"], "page_index": pi, "title": titles.get(pi, ""), "marks": ms} for pi, ms in by_page.items()]
        if checks.finish_house(sheets):
            save_state(pid, st)



def _merge_sheet(pid: str, page_index: int, clean: List[Dict[str, Any]], zone: Optional[Dict[str, float]]) -> int:
    """Put one sheet's fresh marks into the saved state without touching decisions people already made."""
    with _lock:
        st = load_state(pid)
        keep = [m for m in st.get("markers", []) if m.get("page_index") != page_index or m.get("status") in KEEP_ON_RERUN]
        confirmed = [m for m in keep if m.get("page_index") == page_index]

        def near(n):
            ncx, ncy = n["x"] + n["width"] / 2, n["y"] + n["height"] / 2
            r = 0.5 * max(n["width"], n["height"])  # same spot only: a second symbol drawn beside it is kept
            return any(
                e["legend_id"] == n["legend_id"]
                and ((e["x"] + e["width"] / 2 - ncx) ** 2 + (e["y"] + e["height"] / 2 - ncy) ** 2) ** 0.5 < r
                for e in confirmed
            )

        fresh = [m for m in clean if not near(m)]
        st["markers"] = keep + fresh
        ez = st.setdefault("excluded_zones", {})
        if zone:
            ez[str(page_index)] = [{**zone, "label": "Legend"}]
        save_state(pid, st)
        return len(fresh)


def _set_sheet_state(tid: str, key: str, state: str) -> None:
    with _lock:
        t = load_tender(tid)
        if not t:
            return
        t.setdefault("sheet_state", {})[key] = state
        save_tender(t)


def _trusted_legend_zone(pdf: Path, page_index: int, image: np.ndarray) -> Optional[Dict[str, float]]:
    """The detected legend area, kept only if a "Legend" heading sits inside it and it isn't most of the sheet."""
    try:
        z = PDFService.detect_legend_zone(pdf, page_index, 200)
    except Exception:
        z = None
    if not z:
        return None
    try:
        heads = [L for L in _sheet_text_lines(pdf, page_index) if "legend" in " ".join(L["words"]).lower()]
    except Exception:
        heads = []
    inside = any(
        z["x"] <= (L["x0"] + L["x1"]) / 2 <= z["x"] + z["width"] and z["y"] <= (L["y0"] + L["y1"]) / 2 <= z["y"] + z["height"]
        for L in heads
    )
    ih, iw = image.shape[:2]
    if not inside or z["width"] > 0.5 * iw or z["height"] > 0.95 * ih:
        return None
    return z


def stop_run(tid: str) -> Dict[str, Any]:
    """Ask a running takeoff to stop after the sheet it is on. Everything counted so far stays."""
    return update_tender(tid, cancel=True)


# ---------------------------------------------------------------- AI second pass

def _ai_candidates(marks_by_project: Dict[str, List[Dict[str, Any]]], low: float, high: float,
                   project_ids: Optional[List[str]] = None, legend_ids: Optional[List[str]] = None) -> List[tuple]:
    """Borderline marks nobody has decided on and AI hasn't seen yet, best first."""
    band = []
    for pid, ms in marks_by_project.items():
        if project_ids and pid not in project_ids:
            continue
        for m in ms:
            if legend_ids and m["legend_id"] not in legend_ids:
                continue
            if m.get("status") not in ("needs_review", "ai_unverified"):
                continue
            if (m.get("metadata") or {}).get("ai_audit_reason"):
                continue
            if low <= m["confidence_score"] < high:
                band.append((pid, m))
    band.sort(key=lambda x: -x[1]["confidence_score"])
    return band


def _group(band: List[tuple]) -> Dict[tuple, List[Dict[str, Any]]]:
    groups: Dict[tuple, List[Dict[str, Any]]] = {}
    for pid, m in band:
        groups.setdefault((pid, m["page_index"], m["legend_id"]), []).append(m)
    return groups


def estimate_ai(tid: str, low: float, high: float, cap: int = 0,
                project_ids: Optional[List[str]] = None, legend_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    from app.services import cost_ledger

    t = load_tender(tid)
    mbp = {ht["project_id"]: load_state(ht["project_id"]).get("markers", []) for ht in t["house_types"]}
    band = _ai_candidates(mbp, low, high, project_ids, legend_ids)
    capped = band[:cap] if cap else band
    groups = _group(capped)
    calls = sum((len(ms) + 7) // 8 for ms in groups.values())
    per_call, basis = cost_ledger.cost_per_call()
    names = {ht["project_id"]: ht["name"] for ht in t["house_types"]}
    by_house: Dict[str, int] = {}
    for pid, _ in capped:
        by_house[names[pid]] = by_house.get(names[pid], 0) + 1
    return {
        "marks": len(capped),
        "available": len(band),
        "calls": calls,
        "cost_per_call": per_call,
        "estimated_cost": round(calls * per_call, 4),
        "basis": basis,
        "by_house_type": by_house,
    }


def _ai_pass(tid: str, s: Dict[str, Any], house_types: List[Dict[str, Any]],
             marks_by_project: Dict[str, List[Dict[str, Any]]], zones: Dict[tuple, Dict[str, float]],
             symbols: List[Dict[str, Any]], project_ids: Optional[List[str]] = None,
             legend_ids: Optional[List[str]] = None, report=None) -> Dict[str, Any]:
    """Send borderline marks to the AI checker. Mutates marks_by_project in place (keeps / removes)."""
    if report is None:
        def report(done, total, message):
            _progress(tid, stage="ai", done=done, total=total, message=message)
    from app.api.takeoff import VerifyCandidatesRequest, verify_candidates_ai, LegendItem
    from app.services import cost_ledger

    stats = {"checked": 0, "kept": 0, "removed": 0, "calls": 0, "skipped": 0, "error": None, "cost": 0.0}
    band = _ai_candidates(marks_by_project, s["ai_low"], s["auto_high"], project_ids, legend_ids)
    cap = int(s.get("max_ai_marks") or 0)
    if cap and len(band) > cap:
        stats["skipped"] = len(band) - cap
        band = band[:cap]
    groups = _group(band)
    ht_by_id = {ht["project_id"]: ht for ht in house_types}
    sym_by_id = {_legend_from_symbol(x)["legend_id"]: x for x in symbols}
    legends_all = [_legend_from_symbol(x) for x in symbols]
    report(0, len(band), "AI is checking borderline marks…")
    spent_before = cost_ledger.total_for(tid)
    removed_ids: set = set()
    checked = 0

    def ai_job(key, ms):
        cost_ledger.set_tag(tid)
        pid, page_index, legend_id = key
        sym = sym_by_id.get(legend_id)
        if not sym:
            return key, ms, {"verifications": []}
        leg = _legend_from_symbol(sym)
        req = VerifyCandidatesRequest(
            filepath=ht_by_id[pid]["filepath"],
            page_index=page_index,
            legend=LegendItem(**{**leg, "template_crop_coords": None}),
            markers=ms,
            api_key=s.get("api_key"),
            all_legends=[LegendItem(**{**x, "template_crop_coords": None, "template_image_b64": None}) for x in legends_all],
            excluded_zones=[zones[(pid, page_index)]] if zones.get((pid, page_index)) else [],
        )
        return key, ms, verify_candidates_ai(req)

    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(ai_job, k, ms) for k, ms in groups.items()]
        for fut in as_completed(futs):
            try:
                key, ms, res = fut.result()
            except Exception as e:
                stats["error"] = str(getattr(e, "detail", e))
                continue
            stats["calls"] += max(1, (len(ms) + 7) // 8)
            by_id = {v["marker_id"]: v for v in res.get("verifications", [])}
            for m in ms:
                v = by_id.get(m["marker_id"])
                if not v:
                    continue  # deduped or excluded by the verifier; leave for the human
                stats["checked"] += 1
                if v.get("is_valid"):
                    stats["kept"] += 1
                    m["status"] = "ai_verified"
                    m["metadata"] = {
                        "first_pass_score": m["confidence_score"],
                        "ai_audit_reason": v.get("reason"),
                        "ai_audit_confidence": v.get("confidence"),
                    }
                    m["confidence_score"] = round(float(v.get("confidence") or m["confidence_score"]), 3)
                else:
                    stats["removed"] += 1
                    removed_ids.add(m["marker_id"])
            checked += len(ms)
            report(checked, len(band), f"AI checked {checked} of {len(band)} borderline marks · ${cost_ledger.total_for(tid) - spent_before:.2f} so far")
    for pid in marks_by_project:
        marks_by_project[pid] = [m for m in marks_by_project[pid] if m["marker_id"] not in removed_ids]
    stats["cost"] = round(cost_ledger.total_for(tid) - spent_before, 4)
    stats["marks_sent"] = len(band)
    stats["at"] = time.strftime("%Y-%m-%d %H:%M")
    with _lock:
        t = load_tender(tid) or {}
        t.setdefault("ai_runs", []).append(stats)
        save_tender(t)
    return stats


def start_ai_run(tid: str, settings: Dict[str, Any], project_ids: Optional[List[str]] = None,
                 legend_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Run the AI second pass on demand. It can run while counting is still going: it checks what has
    been found so far and merges its verdicts into the saved state."""
    with _lock:
        key = f"{tid}#ai"
        th = _running.get(key)
        if th and th.is_alive():
            raise RuntimeError("An AI check is already running for this tender")
        s = dict(DEFAULT_SETTINGS)
        s.update({k: v for k, v in (settings or {}).items() if k in DEFAULT_SETTINGS})
        t = update_tender(tid, ai_progress={"running": True, "done": 0, "total": 0, "message": "Starting AI check…", "started_at": time.time()})
        th = threading.Thread(target=_ai_run_thread, args=(tid, s, project_ids, legend_ids), daemon=True)
        _running[key] = th
        th.start()
        return t


def _ai_report(tid: str):
    def report(done, total, message):
        with _lock:
            t = load_tender(tid)
            if t:
                ap = dict(t.get("ai_progress") or {})
                ap.update({"running": True, "done": done, "total": total, "message": message})
                t["ai_progress"] = ap
                save_tender(t)
    return report


def _ai_run_core(tid: str, s: Dict[str, Any], project_ids, legend_ids, report=None) -> Dict[str, Any]:
    t = load_tender(tid)
    hts = t["house_types"]
    mbp = {ht["project_id"]: load_state(ht["project_id"]).get("markers", []) for ht in hts}
    zones = {}
    for ht in hts:
        ez = load_state(ht["project_id"]).get("excluded_zones", {}) or {}
        for pg, zs in ez.items():
            if zs:
                zones[(ht["project_id"], int(pg))] = zs[0]
    before = {pid: {m["marker_id"] for m in ms} for pid, ms in mbp.items()}
    stats = _ai_pass(tid, s, hts, mbp, zones, _library_symbols(), project_ids, legend_ids, report=report)
    # Merge into the latest saved state: new sheets and review decisions made meanwhile are kept
    with _lock:
        for pid, ms in mbp.items():
            after = {m["marker_id"]: m for m in ms}
            removed = before[pid] - set(after)
            st = load_state(pid)
            new_ms = []
            for m in st.get("markers", []):
                if m["marker_id"] in removed and m.get("status") in ("needs_review", "ai_unverified"):
                    continue
                upd = after.get(m["marker_id"])
                if upd and upd.get("status") == "ai_verified" and m.get("status") in ("needs_review", "ai_unverified"):
                    m = upd
                new_ms.append(m)
            st["markers"] = new_ms
            save_state(pid, st)
    return stats


def _ai_run_thread(tid: str, s: Dict[str, Any], project_ids, legend_ids) -> None:
    try:
        stats = _ai_run_core(tid, s, project_ids, legend_ids, report=_ai_report(tid))
        failed = stats.get("error") and not stats.get("checked")
        update_tender(tid, ai=stats, ai_progress={
            "running": False, "done": stats.get("marks_sent", 0), "total": stats.get("marks_sent", 0),
            "failed": bool(failed),
            "message": f"AI check failed: {stats['error']}" if failed else f"AI kept {stats['kept']}, removed {stats['removed']} · ${stats.get('cost', 0):.2f}",
            "finished_at": time.time(),
        })
    except Exception as e:
        traceback.print_exc()
        update_tender(tid, ai_progress={"running": False, "failed": True, "message": f"AI check failed: {e}", "finished_at": time.time()})


# ---------------------------------------------------------------- review

def tender_marks(tid: str) -> Dict[str, Any]:
    t = reconcile(load_tender(tid))
    if not t:
        raise KeyError(tid)
    out = []
    for ht in t["house_types"]:
        st = load_state(ht["project_id"])
        out.append({
            "project_id": ht["project_id"],
            "name": ht["name"],
            "filepath": ht["filepath"],
            "plots": ht.get("plots", 1),
            "electrical_pages": ht["electrical_pages"],
            "legends": [{k: v for k, v in l.items() if k != "template_image_b64"} for l in st.get("legends", [])],
            "markers": st.get("markers", []),
        })
    return {"tender": t, "house_types": out}


def apply_decision(project_id: str, marker_id: str, action: str, marker: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    with _lock:
        st = load_state(project_id)
        ms = st.get("markers", [])
        if action == "approve":
            for m in ms:
                if m["marker_id"] == marker_id:
                    m["status"] = "user_verified"
        elif action == "reject":
            st["markers"] = [m for m in ms if m["marker_id"] != marker_id]
        if action in ("approve", "reject"):
            try:  # a person's verdict: the answer key for comparing AI models (services/model_compare.py)
                from app.services import model_compare
                lid = next((m.get("legend_id") for m in ms if m["marker_id"] == marker_id), None)
                model_compare.record_label(marker_id, action == "approve", "review", lid)
            except Exception as e:
                print(f"[pipeline] decision not logged: {e}")
        elif action == "restore" and marker:
            st["markers"] = [m for m in ms if m["marker_id"] != marker["marker_id"]] + [marker]
        else:
            raise ValueError("Unknown action")
        save_state(project_id, st)
        return {"ok": True}


def bulk_approve(project_ids: List[str], marker_ids: List[str]) -> int:
    ids = set(marker_ids)
    n = 0
    with _lock:
        for pid in project_ids:
            st = load_state(pid)
            for m in st.get("markers", []):
                if m["marker_id"] in ids and m.get("status") not in ("user_verified", "manual_added"):
                    m["status"] = "user_verified"
                    m.setdefault("metadata", {})["bulk_approved"] = True  # not looked at one by one
                    n += 1
            save_state(pid, st)
    return n


def set_plots(tid: str, project_id: str, plots: int) -> Dict[str, Any]:
    with _lock:
        t = load_tender(tid)
        for ht in t["house_types"]:
            if ht["project_id"] == project_id:
                ht["plots"] = max(1, int(plots))
                ht["plots_source"] = {"manual": True}
        save_tender(t)
        return t



# ---------------------------------------------------------------- sheet selection

def set_sheets(tid: str, rel_path: str, page_indexes: List[int]) -> Dict[str, Any]:
    """Choose which pages of a PDF are counted. Picking pages in a 'document' makes it a house type;
    clearing every page of a house type moves it back to documents."""
    with _lock:
        t = load_tender(tid)
        if not t:
            raise KeyError(tid)
        chosen = sorted(set(int(i) for i in page_indexes))
        ht = next((h for h in t["house_types"] if h["rel_path"] == rel_path), None)
        doc = next((d for d in t["documents"] if d.get("path") == rel_path), None)
        if ht:
            sheets = ht.get("sheets") or []
            if not chosen:
                t["house_types"].remove(ht)
                t["documents"].append({
                    "path": rel_path, "kind": "pdf", "pages": ht["total_pages"], "filepath": ht["filepath"],
                    "sheets": sheets, "maybe": sum(1 for p in sheets if p.get("verdict") == "maybe"),
                    "plots": ht.get("plots", 1), "plots_source": ht.get("plots_source"),
                })
        elif doc and chosen:
            sheets = doc.get("sheets") or []
            ht = {
                "project_id": f"proj_{uuid.uuid4().hex[:8]}",
                "name": Path(rel_path).stem,
                "filename": Path(rel_path).name,
                "filepath": doc["filepath"],
                "rel_path": rel_path,
                "total_pages": doc.get("pages") or len(sheets),
                "sheets": sheets,
                "plots": doc.get("plots", 1),
                "plots_source": doc.get("plots_source"),
            }
            t["documents"].remove(doc)
            t["house_types"].append(ht)
        elif not doc:
            raise KeyError(rel_path)
        if ht and chosen:
            ht["sheets_set_by_hand"] = True  # a re-run won't re-pick this house type's sheets
            by_idx = {p["page_index"]: p for p in (ht.get("sheets") or [])}
            ht["electrical_pages"] = [
                {"page_index": i, "page_number": i + 1, "title": (by_idx.get(i) or {}).get("title", "")} for i in chosen
            ]
            ht["sheets_confirmed"] = True
        save_tender(t)
    # A newly promoted house type may now match the schedule
    if ht and chosen and not ht.get("plots_source"):
        t = load_tender(tid)
        _apply_schedule(tid, t["house_types"], t["documents"])
        t2 = load_tender(tid)
        t2["house_types"] = t["house_types"]
        save_tender(t2)
    return load_tender(tid)
