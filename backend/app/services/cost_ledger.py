"""
Running record of what the AI has cost.

Every OpenAI call made through create_vision_chat_completion lands here with its real
token usage, priced at the list prices below (USD per 1M tokens). Update PRICES if
OpenAI changes them; past entries keep the cost they were recorded at.
"""
from __future__ import annotations

import json
import threading
import time
from collections import defaultdict
from typing import Any, Dict, Optional, Tuple

from app.core.config import DATA_DIR

PRICES = {  # model: (input, output) USD per 1M tokens
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-5-mini": (0.25, 2.00),
}
# Before any real calls: ~4,200 input + ~700 output tokens per 8-mark check on gpt-4o
DEFAULT_COST_PER_CALL = round(4200 * 2.50 / 1e6 + 700 * 10.00 / 1e6, 4)

LEDGER = DATA_DIR / "ai_costs.json"
_lock = threading.Lock()
_ctx = threading.local()


def set_tag(tag: Optional[str]) -> None:
    """Label calls made on this thread (e.g. the tender id) so spend can be split per tender."""
    _ctx.tag = tag


def current_tag() -> str:
    return getattr(_ctx, "tag", None) or "workspace"


def _rates(model: str) -> Tuple[float, float]:
    """USD per 1M tokens: our table for OpenAI models, else OpenRouter's public list, else GPT-4o's."""
    bare = model.split("/", 1)[1] if model.startswith("openai/") else model
    if bare in PRICES:
        return PRICES[bare]
    try:
        from app.services import ai_provider
        pp = ai_provider.price_per_token(model)
        if pp:
            return pp[0] * 1e6, pp[1] * 1e6
    except Exception:
        pass
    return PRICES["gpt-4o"]


def _reported_cost(usage: Any) -> Optional[float]:
    """OpenRouter puts the real charge for the call in usage.cost (thinking tokens included)."""
    c = getattr(usage, "cost", None)
    if c is None:
        extra = getattr(usage, "model_extra", None) or {}
        c = extra.get("cost")
    try:
        return float(c) if c is not None else None
    except (TypeError, ValueError):
        return None


def price(model: str, usage: Any) -> Dict[str, Any]:
    pin = int(getattr(usage, "prompt_tokens", 0) or 0)
    pout = int(getattr(usage, "completion_tokens", 0) or 0)
    pi, po = _rates(model)
    cost = _reported_cost(usage)
    return {"input_tokens": pin, "output_tokens": pout,
            "cost": round(cost if cost is not None else pin * pi / 1e6 + pout * po / 1e6, 6)}


def _load() -> list:
    if not LEDGER.exists():
        return []
    try:
        with open(LEDGER) as f:
            return json.load(f)
    except Exception:
        return []


def record(model: str, usage: Any, kind: str = "vision") -> Dict[str, Any]:
    priced = price(model, usage)
    pin, pout = priced["input_tokens"], priced["output_tokens"]
    entry = {
        "ts": time.time(),
        "day": time.strftime("%Y-%m-%d"),
        "model": model,
        "kind": kind,
        "tag": getattr(_ctx, "tag", None) or "workspace",
        "input_tokens": pin,
        "output_tokens": pout,
        "cost": priced["cost"],
    }
    with _lock:
        data = _load()
        data.append(entry)
        tmp = LEDGER.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(data, f)
        tmp.replace(LEDGER)
    return entry


def total_for(tag: str) -> float:
    with _lock:
        return round(sum(e["cost"] for e in _load() if e.get("tag") == tag), 6)


def cost_per_call() -> Tuple[float, str]:
    """Average real cost of recent mark-checking calls with the model now chosen, or an estimate at its price."""
    try:
        from app.services import ai_provider
        _, model = ai_provider.active()
    except Exception:
        model = "gpt-4o"
    same = {model, model.split("/", 1)[1] if model.startswith("openai/") else f"openai/{model}"}
    with _lock:
        recent = [e for e in _load() if e.get("kind") == "vision" and e.get("cost") and e.get("model") in same][-50:]
    if len(recent) >= 3:
        return round(sum(e["cost"] for e in recent) / len(recent), 5), f"average of your last {len(recent)} calls with {model}"
    pi, po = _rates(model)
    return round(4200 * pi / 1e6 + 700 * po / 1e6, 5), f"estimate at {model} list prices"


def summary(tag_names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    with _lock:
        data = _load()
    today = time.strftime("%Y-%m-%d")
    by_day: Dict[str, float] = defaultdict(float)
    by_tag: Dict[str, Dict[str, float]] = defaultdict(lambda: {"cost": 0.0, "calls": 0})
    for e in data:
        by_day[e["day"]] += e["cost"]
        by_tag[e["tag"]]["cost"] += e["cost"]
        by_tag[e["tag"]]["calls"] += 1
    names = tag_names or {}
    return {
        "total": round(sum(e["cost"] for e in data), 4),
        "today": round(by_day.get(today, 0.0), 4),
        "calls": len(data),
        "tokens": {"input": sum(e["input_tokens"] for e in data), "output": sum(e["output_tokens"] for e in data)},
        "by_day": [{"day": d, "cost": round(c, 4)} for d, c in sorted(by_day.items())][-30:],
        "by_tender": sorted(
            [{"tag": k, "name": names.get(k, "Manual workspace" if k == "workspace" else k), "cost": round(v["cost"], 4), "calls": v["calls"]}
             for k, v in by_tag.items()],
            key=lambda x: -x["cost"],
        ),
        "recent": data[-15:][::-1],
        "prices": PRICES,
        "currency": "USD",
    }


def reset() -> None:
    with _lock:
        if LEDGER.exists():
            LEDGER.unlink()
