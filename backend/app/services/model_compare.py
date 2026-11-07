"""
Which AI model should do the second-pass check? Compare them on real checks, not benchmarks.

Every AI check is saved in the audit log with the exact pictures and instructions it sent. A comparison
replays a sample of those saved checks through each chosen model (via OpenRouter) and scores the answers:

  - against people: marks a reviewer approved (real) or deleted (not real) in the review queue, plus marks
    you judge in the comparison itself ("labels"). This is the score that decides.
  - against GPT-4o's original answer: how often a model agrees with what we use today.
  - real cost (OpenRouter reports each call's charge) and seconds per check.

The recommendation is the cheapest model at least as accurate as GPT-4o on the marks people have judged,
with at least MIN_JUDGED of them; until then it says how many more to judge, and shows the marks where the
models disagree so you can judge exactly the ones that matter.
"""
from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from app.core.config import DATA_DIR

RESULTS_FILE = DATA_DIR / "model_compare.json"
LABELS_FILE = DATA_DIR / "review_decisions.json"
BASELINE = "openai/gpt-4o"
MIN_JUDGED = 40
_lock = threading.Lock()
_thread: Optional[threading.Thread] = None


# ---------------------------------------------------------------- what people decided
def _load_labels() -> Dict[str, Dict[str, Any]]:
    try:
        with open(LABELS_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def record_label(marker_id: str, valid: bool, source: str, legend_id: Optional[str] = None) -> None:
    """A person's verdict on a mark: from the review queue (approve / delete) or judged in a comparison."""
    with _lock:
        d = _load_labels()
        d[marker_id] = {"valid": bool(valid), "source": source, "legend_id": legend_id, "ts": time.time()}
        LABELS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = LABELS_FILE.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(d, f)
        tmp.replace(LABELS_FILE)


def _truth() -> Dict[str, bool]:
    """marker_id -> real or not, from people: decisions log, plus marks approved in any saved state."""
    out = {k: v["valid"] for k, v in _load_labels().items()}
    try:
        from app.core.config import PROJECTS_DIR
        for f in PROJECTS_DIR.glob("*/state.json"):
            try:
                st = json.loads(f.read_text())
            except Exception:
                continue
            for m in st.get("markers", []):
                if m.get("status") == "user_verified" and not (m.get("metadata") or {}).get("bulk_approved"):
                    out.setdefault(m["marker_id"], True)
    except Exception:
        pass
    return out


# ---------------------------------------------------------------- the saved checks
def _sample(n_checks: int) -> List[Dict[str, Any]]:
    """Saved checks to replay: those holding the most marks people have judged first, then the most recent."""
    from app.services.audit_logger import get_audit_logs  # newest first; the log keeps the last 100 checks
    truth = _truth()
    logs = [l for l in get_audit_logs()
            if l.get("candidates") and l.get("template_image_b64") and l.get("prompt_text") and "(Error)" not in str(l.get("model_used"))]
    order = {id(l): i for i, l in enumerate(logs)}
    logs.sort(key=lambda l: (-sum(1 for c in l["candidates"] if c["marker_id"] in truth), order[id(l)]))
    return logs[:n_checks]


def _ask(model: str, log: Dict[str, Any]) -> Dict[str, Any]:
    from app.services import ai_provider, cost_ledger
    from app.services.openai_service import build_check_content, create_vision_chat_completion
    batch = [{"marker_id": c["marker_id"], "patch_b64": c["patch_b64"], "angle": c.get("angle"),
              "nearby_codes": c.get("nearby_codes")} for c in log["candidates"]]
    strip = log.get("template_strip_b64") or log["template_image_b64"]
    content = build_check_content(log["prompt_text"], log["template_image_b64"], strip, batch)
    t0 = time.time()
    try:
        client = ai_provider.client_for("openrouter")
        resp, _ = create_vision_chat_completion(client, [{"role": "user", "content": content}], model=model,
                                                provider="openrouter", record=False, response_format={"type": "json_object"})
        data = json.loads(resp.choices[0].message.content or "{}")
        verdicts = {}
        for v in data.get("verifications", []):
            i = int(v.get("candidate_index", 0)) - 1
            if 0 <= i < len(batch):
                verdicts[batch[i]["marker_id"]] = {"valid": bool(v.get("is_valid", False)), "reason": str(v.get("reason", ""))[:300]}
        cost = cost_ledger.price(model, getattr(resp, "usage", None))
        try:  # it is real spend: put it in the ledger, tagged as a comparison
            cost_ledger.set_tag("model-comparison")
            cost_ledger.record(model, resp.usage, kind="compare")
        except Exception:
            pass
        return {"ok": True, "verdicts": verdicts, "cost": cost["cost"], "seconds": round(time.time() - t0, 2),
                "tokens": [cost["input_tokens"], cost["output_tokens"]]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300], "verdicts": {}, "cost": 0.0, "seconds": round(time.time() - t0, 2)}


# ---------------------------------------------------------------- running a comparison
def _save(res: Dict[str, Any]) -> None:
    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = RESULTS_FILE.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(res, f)
    tmp.replace(RESULTS_FILE)


def load_results() -> Dict[str, Any]:
    try:
        with open(RESULTS_FILE) as f:
            res = json.load(f)
    except Exception:
        return {"status": "none"}
    return score(res)


def estimate(models: List[str], n_checks: int) -> Dict[str, Any]:
    from app.services import ai_provider
    checks = len(_sample(n_checks))
    per = {}
    for m in models:
        pp = ai_provider.price_per_token(m)
        per[m] = round(checks * (4200 * pp[0] + 700 * pp[1]), 4) if pp else None
    return {"checks": checks, "marks": checks * 8, "per_model": per,
            "total": round(sum(v for v in per.values() if v), 4)}


def start(models: List[str], n_checks: int = 30) -> Dict[str, Any]:
    global _thread
    from app.services import ai_provider
    if not ai_provider.openrouter_key():
        raise ValueError("Paste your OpenRouter key in AI model settings first: the comparison runs every model through OpenRouter.")
    if _thread and _thread.is_alive():
        raise RuntimeError("A comparison is already running")
    models = list(dict.fromkeys([BASELINE] + [m for m in models if m]))
    logs = _sample(n_checks)
    if not logs:
        raise ValueError("No saved AI checks yet. Run the AI check on a tender first: the comparison replays those checks.")
    res = {"status": "running", "started": time.time(), "models": models, "checks": len(logs),
           "done": 0, "total": len(logs) * len(models), "items": {}, "runs": {m: [] for m in models}}
    for l in logs:
        for c in l["candidates"]:
            orig = next((v for v in l.get("verifications", []) if v.get("marker_id") == c["marker_id"]), None)
            res["items"][c["marker_id"]] = {
                "legend": l.get("legend_label"), "patch_b64": c["patch_b64"], "log_id": l.get("id"),
                "original": {"model": l.get("model_used"), "valid": orig.get("is_valid") if orig else None,
                             "reason": (orig or {}).get("reason", "")[:300]},
                "answers": {},
            }
    _save(res)

    def run():
        jobs = [(m, l) for m in models for l in logs]
        with ThreadPoolExecutor(max_workers=6) as ex:
            for (m, l), out in zip(jobs, ex.map(lambda j: _ask(*j), jobs)):
                with _lock:
                    res["runs"][m].append({k: out[k] for k in ("ok", "cost", "seconds") if k in out} | ({"error": out["error"]} if not out["ok"] else {}))
                    for mid, v in out["verdicts"].items():
                        if mid in res["items"]:
                            res["items"][mid]["answers"][m] = v
                    res["done"] += 1
                    if res["done"] % 5 == 0:
                        _save(res)
        res["status"] = "done"
        res["finished"] = time.time()
        _save(res)

    _thread = threading.Thread(target=run, daemon=True)
    _thread.start()
    return score(res)


def score(res: Dict[str, Any]) -> Dict[str, Any]:
    """Per-model scores, the recommendation and the marks the models disagree on (computed on read, so
    judging a mark updates the scores straight away)."""
    if res.get("status") in (None, "none"):
        return res
    truth = _truth()
    models = res.get("models", [])
    rows = []
    for m in models:
        runs = res["runs"].get(m, [])
        answered = [(mid, it["answers"][m]["valid"]) for mid, it in res["items"].items() if m in it["answers"]]
        judged = [(mid, v) for mid, v in answered if mid in truth]
        right = sum(1 for mid, v in judged if v == truth[mid])
        missed_real = sum(1 for mid, v in judged if truth[mid] and not v)       # removed a real symbol
        kept_false = sum(1 for mid, v in judged if not truth[mid] and v)        # kept a wrong one
        base = [(mid, v) for mid, v in answered if res["items"][mid]["answers"].get(BASELINE) is not None]
        agree = sum(1 for mid, v in base if v == res["items"][mid]["answers"][BASELINE]["valid"])
        ok_runs = [r for r in runs if r.get("ok")]
        marks = len(answered)
        cost = sum(r.get("cost", 0) for r in ok_runs)
        rows.append({
            "model": m, "checks": len(runs), "failed": len(runs) - len(ok_runs), "answered": marks,
            "judged": len(judged), "right": right,
            "accuracy": round(right / len(judged), 4) if judged else None,
            "removed_real": missed_real, "kept_wrong": kept_false,
            "agrees_with_gpt4o": round(agree / len(base), 4) if base and m != BASELINE else None,
            "cost": round(cost, 5), "cost_per_1000_marks": round(cost / marks * 1000, 3) if marks else None,
            "seconds_per_check": round(sum(r.get("seconds", 0) for r in ok_runs) / len(ok_runs), 1) if ok_runs else None,
            "errors": list({r.get("error") for r in runs if not r.get("ok")})[:3],
        })
    base_row = next((r for r in rows if r["model"] == BASELINE), None)
    rec, why = None, ""
    judged_n = base_row["judged"] if base_row else 0
    if res.get("status") == "done":
        if judged_n < MIN_JUDGED:
            why = (f"Only {judged_n} of these marks have been judged by a person; judge at least {MIN_JUDGED} "
                   "(start with the disagreements below) before trusting a winner.")
        elif base_row and base_row["accuracy"] is not None:
            # at least as accurate as GPT-4o, never removing more real symbols (an under-count loses Jeffway money),
            # and no failed checks
            good = [r for r in rows if r["accuracy"] is not None and r["failed"] == 0 and r["accuracy"] >= base_row["accuracy"]
                    and r["removed_real"] <= base_row["removed_real"] and r["cost_per_1000_marks"] is not None]
            if good:
                best = min(good, key=lambda r: (r["cost_per_1000_marks"], -r["accuracy"]))
                rec = best["model"]
                why = (f"{best['model']} is right on {best['right']} of {best['judged']} judged marks "
                       f"({round(best['accuracy'] * 100)}% vs GPT-4o's {round(base_row['accuracy'] * 100)}%) "
                       f"at ${best['cost_per_1000_marks']} per 1,000 marks (GPT-4o ${base_row['cost_per_1000_marks']}).")
            else:
                why = "No model was at least as accurate as GPT-4o, without removing more real symbols, on the judged marks: keep GPT-4o."
    disagreements = []
    for mid, it in res.get("items", {}).items():
        vals = {a["valid"] for a in it["answers"].values()}
        if len(vals) > 1:
            disagreements.append({"marker_id": mid, "legend": it["legend"], "patch_b64": it["patch_b64"],
                                  "answers": {m: a for m, a in it["answers"].items()},
                                  "judged": truth.get(mid)})
    disagreements.sort(key=lambda d: d["judged"] is not None)
    return {k: v for k, v in res.items() if k not in ("items", "runs")} | {
        "scores": rows, "recommended": rec, "why": why, "judged_marks": judged_n, "min_judged": MIN_JUDGED,
        "disagreements": disagreements[:200], "disagreement_count": len(disagreements),
    }
