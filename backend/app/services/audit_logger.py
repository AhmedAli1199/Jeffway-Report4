from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import time
import uuid
import json
from pathlib import Path

class AuditLogItem(BaseModel):
    id: str
    timestamp: str
    legend_label: str
    template_image_b64: str
    candidates: List[Dict[str, Any]] # [{"marker_id": str, "patch_b64": str, "index": int}]
    prompt_text: str
    raw_response: str
    verifications: List[Dict[str, Any]]
    model_used: Optional[str] = "gpt-4o"

LOGS_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "audit_logs.json"

def _load_logs() -> List[Dict[str, Any]]:
    if LOGS_FILE.exists():
        try:
            with open(LOGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[AuditLogger] Read error: {e}")
            return []
    return []

def _save_logs(logs: List[Dict[str, Any]]):
    try:
        LOGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOGS_FILE, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)
    except Exception as e:
        print(f"[AuditLogger] Save error: {e}")

def record_audit_log(
    legend_label: str,
    template_b64: str,
    candidates: List[Dict[str, Any]],
    prompt_text: str,
    raw_response: str,
    verifications: List[Dict[str, Any]],
    model_used: str = "gpt-4o",
    template_strip_b64: str = "",
    usage: Optional[Dict[str, Any]] = None,
    tag: Optional[str] = None,
):
    logs = _load_logs()
    log_entry = {
        "id": f"log_{uuid.uuid4().hex[:8]}",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "legend_label": legend_label,
        "template_image_b64": template_b64,
        "candidates": candidates,
        "prompt_text": prompt_text,
        "raw_response": raw_response,
        "verifications": verifications,
        "model_used": model_used,
        "template_strip_b64": template_strip_b64,
        "usage": usage or {},
        "tag": tag,
    }
    logs.insert(0, log_entry)
    if len(logs) > 100:
        logs = logs[:100]
    _save_logs(logs)

def get_audit_logs() -> List[Dict[str, Any]]:
    return _load_logs()


def summarize(log: Dict[str, Any]) -> Dict[str, Any]:
    """A log entry without its images, for the list view."""
    v = log.get("verifications") or []
    kept = sum(1 for x in v if x.get("is_valid"))
    return {
        "id": log.get("id"),
        "timestamp": log.get("timestamp"),
        "legend_label": log.get("legend_label"),
        "model_used": log.get("model_used"),
        "candidates": len(log.get("candidates") or []),
        "answered": len(v),
        "kept": kept,
        "removed": len(v) - kept,
        "cost": (log.get("usage") or {}).get("cost"),
        "tag": log.get("tag"),
        "error": "(Error)" in str(log.get("model_used") or ""),
    }


def get_audit_log(log_id: str) -> Optional[Dict[str, Any]]:
    return next((l for l in _load_logs() if l.get("id") == log_id), None)

def clear_audit_logs():
    _save_logs([])
