"""
Which AI model does the second-pass check, and through whom.

  provider "openai"      OpenAI directly (key from the browser or OPENAI_API_KEY), model e.g. gpt-4o
  provider "openrouter"  OpenRouter: one key for every model (Gemini, GPT, Claude ...), OpenAI-compatible API

Settings live in backend/data/ai_settings.json on this machine (git-ignored). The OpenRouter key is stored
there and never sent back to the browser in full. Prices for OpenRouter models come from OpenRouter's public
model list, and each call's real cost is read back from OpenRouter's usage report.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from openai import OpenAI

from app.core.config import settings, DATA_DIR

SETTINGS_FILE = DATA_DIR / "ai_settings.json"
OPENROUTER_BASE = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
_lock = threading.Lock()

DEFAULTS: Dict[str, Any] = {"provider": "openai", "model": "gpt-4o", "openrouter_key": ""}

# Shown first in the model picker and ticked by default in the comparison (vision models, cheapest last)
SUGGESTED = [
    ("openai/gpt-4o", "GPT-4o (today's model, the yardstick)"),
    ("google/gemini-3.8-flash", "Gemini 3.8 Flash (newest Flash)"),
    ("google/gemini-3.6-flash", "Gemini 3.6 Flash"),
    ("google/gemini-3-flash-preview", "Gemini 3 Flash Preview"),
    ("google/gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"),
    ("google/gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"),
    ("google/gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite (cheapest)"),
]
OPTIONAL = [
    ("openai/gpt-5.6-luna", "GPT-5.6 Luna"),
    ("anthropic/claude-haiku-5.5", "Claude Haiku 5.5"),
    ("google/gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview (expensive)"),
]


def load() -> Dict[str, Any]:
    try:
        with open(SETTINGS_FILE) as f:
            return {**DEFAULTS, **json.load(f)}
    except Exception:
        return dict(DEFAULTS)


def save(patch: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        cur = load()
        for k in ("provider", "model"):
            if patch.get(k):
                cur[k] = str(patch[k]).strip()
        if patch.get("openrouter_key") is not None:
            key = str(patch["openrouter_key"]).strip()
            if key and not key.startswith("•"):  # the masked value sent back unchanged means "keep it"
                cur["openrouter_key"] = key
            elif key == "":
                cur["openrouter_key"] = ""
        if cur["provider"] not in ("openai", "openrouter"):
            cur["provider"] = "openai"
        if cur["provider"] == "openai" and "/" in cur["model"]:
            cur["model"] = cur["model"].split("/", 1)[1] if cur["model"].startswith("openai/") else "gpt-4o"
        if cur["provider"] == "openrouter" and "/" not in cur["model"]:
            cur["model"] = f"openai/{cur['model']}"
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(SETTINGS_FILE, "w") as f:
            json.dump(cur, f, indent=2)
        return cur


def _mask(key: str) -> str:
    return f"••••{key[-4:]}" if key else ""


def openrouter_key(cfg: Optional[Dict[str, Any]] = None) -> str:
    cfg = cfg or load()
    return cfg.get("openrouter_key") or os.getenv("OPENROUTER_API_KEY", "")


def client_for(provider: str, api_key: Optional[str] = None) -> OpenAI:
    if provider == "openrouter":
        key = openrouter_key()
        if not key:
            raise ValueError("OpenRouter key not set. Paste it under AI model settings.")
        return OpenAI(base_url=OPENROUTER_BASE, api_key=key,
                      default_headers={"HTTP-Referer": "https://plotline.local", "X-Title": "Plotline takeoff"})
    key = api_key or settings.openai_api_key or os.getenv("OPENAI_API_KEY", "")
    if not key:
        raise ValueError("OpenAI API key not provided. Please provide an API key in settings or pass it in the request.")
    return OpenAI(api_key=key)


def active() -> Tuple[str, str]:
    cfg = load()
    return cfg["provider"], cfg["model"]


def call_extras(provider: str, model: str) -> Dict[str, Any]:
    """Per-call extras: OpenRouter reports each call's real cost; thinking models are asked to think briefly
    (their thinking is billed as output, and a yes/no on a symbol picture doesn't need much of it)."""
    if provider != "openrouter":
        return {}
    body: Dict[str, Any] = {"usage": {"include": True}}
    info = model_info(model)
    if info and "reasoning" in (info.get("supported_parameters") or []):
        body["reasoning"] = {"effort": "low", "exclude": True}
    return {"extra_body": body}


# ---------------------------------------------------------------- OpenRouter model list + prices
_models_cache: Dict[str, Any] = {"t": 0.0, "data": {}}


def _models() -> Dict[str, Dict[str, Any]]:
    if time.time() - _models_cache["t"] < 6 * 3600 and _models_cache["data"]:
        return _models_cache["data"]
    try:
        r = httpx.get(f"{OPENROUTER_BASE}/models", timeout=20)
        r.raise_for_status()
        data = {m["id"]: m for m in r.json().get("data", [])}
        _models_cache.update(t=time.time(), data=data)
    except Exception as e:
        print(f"[ai_provider] model list unavailable: {e}")
    return _models_cache["data"]


def model_info(model: str) -> Optional[Dict[str, Any]]:
    return _models().get(model)


def price_per_token(model: str) -> Optional[Tuple[float, float]]:
    """(input, output) USD per token for an OpenRouter model, from its public list."""
    m = model_info(model) if "/" in model else model_info(f"openai/{model}")
    if not m:
        return None
    p = m.get("pricing") or {}
    try:
        return float(p.get("prompt") or 0), float(p.get("completion") or 0)
    except (TypeError, ValueError):
        return None


def catalogue() -> List[Dict[str, Any]]:
    """Vision models for the picker: the suggested ones first, then the rest OpenRouter lists."""
    ms = _models()
    out, seen = [], set()

    def row(mid: str, label: str, group: str) -> Optional[Dict[str, Any]]:
        m = ms.get(mid)
        if ms and not m:
            return None  # no longer listed by OpenRouter
        pp = price_per_token(mid) if m else None
        return {"id": mid, "label": label, "group": group,
                "input_per_m": round(pp[0] * 1e6, 3) if pp else None,
                "output_per_m": round(pp[1] * 1e6, 3) if pp else None,
                "per_check": round(4200 * pp[0] + 700 * pp[1], 5) if pp else None}

    for mid, label in SUGGESTED:
        r = row(mid, label, "suggested")
        if r:
            out.append(r)
            seen.add(mid)
    for mid, label in OPTIONAL:
        r = row(mid, label, "other")
        if r:
            out.append(r)
            seen.add(mid)
    for mid, m in sorted(ms.items()):
        if mid in seen or mid.endswith(":batch") or "image" not in ((m.get("architecture") or {}).get("input_modalities") or []):
            continue
        if not mid.startswith(("google/gemini", "openai/gpt", "anthropic/claude", "qwen/")):
            continue
        if "image" in mid.split("/")[1] and "gemini" in mid:  # image-generation models
            continue
        r = row(mid, m.get("name") or mid, "all")
        if r:
            out.append(r)
    return out


def public() -> Dict[str, Any]:
    cfg = load()
    has_openai = bool(settings.openai_api_key or os.getenv("OPENAI_API_KEY"))
    return {
        "provider": cfg["provider"], "model": cfg["model"],
        "openrouter_key": _mask(openrouter_key(cfg)), "openrouter_key_set": bool(openrouter_key(cfg)),
        "openai_key_on_server": has_openai,
        "ready": bool(openrouter_key(cfg)) if cfg["provider"] == "openrouter" else has_openai,
    }
