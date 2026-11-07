"""AI model settings (OpenAI or OpenRouter, which model) and the model comparison."""
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import ai_provider, model_compare

router = APIRouter()


class SettingsIn(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
    openrouter_key: Optional[str] = None


class CompareIn(BaseModel):
    models: List[str]
    checks: int = 30


class LabelIn(BaseModel):
    marker_id: str
    valid: bool


@router.get("/settings")
def get_settings():
    return ai_provider.public()


@router.post("/settings")
def set_settings(body: SettingsIn):
    ai_provider.save(body.model_dump())
    return ai_provider.public()


@router.get("/catalogue")
def catalogue():
    return {"models": ai_provider.catalogue()}


@router.post("/compare/estimate")
def compare_estimate(body: CompareIn):
    return model_compare.estimate(body.models, max(1, min(body.checks, 100)))


@router.post("/compare")
def compare_start(body: CompareIn):
    try:
        return model_compare.start(body.models, max(1, min(body.checks, 100)))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(400, str(e))


@router.get("/compare")
def compare_results():
    return model_compare.load_results()


@router.post("/compare/label")
def compare_label(body: LabelIn):
    model_compare.record_label(body.marker_id, body.valid, "compare")
    return model_compare.load_results()
