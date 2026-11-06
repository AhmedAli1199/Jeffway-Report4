"""
Free second check for first-pass marks, using the CAD layers kept in the PDF.

Architects' CAD files put electrical symbols on their own layers (Curo's: DOWNLIGHTER, CEILING FANS,
FIRE DETECTION, CEILING MOUNTED EXTRACT, SERVICES, S_ELEC ITEM ...) and the PDFs keep those layers.
So for every mark we can ask what layer the strokes inside it are drawn on. A downlight-shaped match
on the RADIATOR layer is a radiator, whatever its image score.

Layer names differ between architects, so nothing is hard-coded: for each tender we learn which layers
each symbol's strong matches sit on, and judge the weaker marks against that.
"""
from __future__ import annotations

import collections
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional, Set, Tuple

import fitz

STRONG = 0.85          # matches this good teach us where a symbol is drawn
SPECIFIC_SHARE = 0.8   # a layer is "this symbol's own" if 80%+ of strong matches on it are this symbol
MIN_EVIDENCE = 2       # strong matches needed before a layer counts as electrical / as a symbol's layer
# Layer names that are plainly electrical even before any strong match is seen on them
ELECTRICAL_NAME = re.compile(r"ELEC|LIGHT|POWER|SWITCH|SOCKET|FIRE|SMOKE|DETECT|SERVICE|FAN|EXTRACT|ALARM|DATA|TV|AERIAL", re.I)


@lru_cache(maxsize=32)
def sheet_paths(pdf: str, page_index: int, dpi: int = 200) -> Tuple[Tuple[float, float, float, float, str, str], ...]:
    """Vector paths in rendered-image pixels: (x0, y0, x1, y1, layer, shape).

    shape is what the path is made of, e.g. "cll" (a curve and two lines) or "llF" (filled): it doesn't
    change with position, size or rotation, so every copy of one CAD block gives the same shapes."""
    k = dpi / 72.0
    out = []
    with fitz.open(pdf) as doc:
        page = doc[page_index]
        rot = page.rotation_matrix
        for d in page.get_drawings():
            r = fitz.Rect(d["rect"]) * rot
            shape = "".join(sorted(it[0] for it in d["items"])) + ("F" if d.get("fill") is not None else "")
            out.append((r.x0 * k, r.y0 * k, r.x1 * k, r.y1 * k, d.get("layer") or "", shape))
    return tuple(out)


def has_layers(paths) -> bool:
    return len({p[4] for p in paths if p[4]}) >= 5


def mark_layer(m: Dict[str, Any], paths) -> Optional[str]:
    """The layer most of the strokes inside this mark are drawn on (strokes crossing it, like walls, don't count)."""
    x0, y0 = m["x"] - 4, m["y"] - 4
    x1, y1 = m["x"] + m["width"] + 4, m["y"] + m["height"] + 4
    c = collections.Counter(p[4] for p in paths if p[4] and p[0] >= x0 and p[1] >= y0 and p[2] <= x1 and p[3] <= y1)
    return c.most_common(1)[0][0] if c else None


class LayerKnowledge:
    """What a tender has taught us so far about which layers each symbol is drawn on."""

    def __init__(self, groups: Dict[str, str]):
        # groups: legend_id -> group key; symbols with identical samples (standard / IP downlight) share one
        self.groups = groups
        self.by_symbol: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        self.by_layer: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)

    def g(self, legend_id: str) -> str:
        return self.groups.get(legend_id, legend_id)

    def learn(self, marks: List[Dict[str, Any]], paths) -> None:
        for m in marks:
            if m["confidence_score"] >= STRONG:
                L = mark_layer(m, paths)
                if L:
                    self.by_symbol[self.g(m["legend_id"])][L] += 1
                    self.by_layer[L][self.g(m["legend_id"])] += 1

    def electrical_layers(self) -> Set[str]:
        return {L for L, c in self.by_layer.items() if sum(c.values()) >= MIN_EVIDENCE}

    def own_layers(self, legend_id: str) -> Set[str]:
        c = self.by_symbol.get(self.g(legend_id), collections.Counter())
        total = sum(c.values())
        return {L for L, n in c.items() if n >= MIN_EVIDENCE or (total and n / total >= 0.3)}

    def specific_to(self, layer: str, legend_id: str) -> bool:
        c = self.by_layer.get(layer)
        if not c or sum(c.values()) < MIN_EVIDENCE:
            return False
        return c[self.g(legend_id)] / sum(c.values()) >= SPECIFIC_SHARE

    def judge(self, m: Dict[str, Any], paths) -> Optional[Dict[str, Any]]:
        """Verdict for one mark, or None when there's nothing to go on yet."""
        elec = self.electrical_layers()
        if not elec:
            return None
        L = mark_layer(m, paths)
        own = self.own_layers(m["legend_id"])
        if L is None:
            return {"layer": None, "verdict": "off", "note": "No CAD strokes of its own inside it (likely text or linework)"}
        if L in own and self.specific_to(L, m["legend_id"]):
            return {"layer": L, "verdict": "confirmed", "note": f'Drawn on the "{L}" layer, where only this symbol is drawn'}
        if L in own:
            return {"layer": L, "verdict": "ok", "note": f'Drawn on the "{L}" layer, like this symbol\'s strong matches'}
        if L in elec or ELECTRICAL_NAME.search(L):
            if own and L in elec:
                return {"layer": L, "verdict": "elsewhere", "note": f'Drawn on the "{L}" layer; this symbol is drawn on "{", ".join(sorted(own))}"'}
            return {"layer": L, "verdict": "ok", "note": f'Drawn on the electrical layer "{L}"'}
        if not own:
            # Too few strong matches of this symbol (e.g. one consumer unit per house) to know its layer: don't judge
            return {"layer": L, "verdict": "unknown", "note": f'Drawn on the "{L}" layer; not enough strong matches yet to know where this symbol is drawn'}
        return {"layer": L, "verdict": "off", "note": f'Drawn on the "{L}" layer, which holds no electrical symbols; this symbol is drawn on "{", ".join(sorted(own))}"'}


def apply(marks: List[Dict[str, Any]], paths, know: LayerKnowledge, auto_high: float) -> Dict[str, int]:
    """Adjust first-pass marks by their CAD layer. Returns how many were confirmed / marked down.

    Only marks below STRONG are judged; strong matches are what the knowledge was learned from."""
    stats = {"confirmed": 0, "down": 0}
    for m in marks:
        if m["confidence_score"] >= STRONG:
            continue
        v = know.judge(m, paths)
        if not v or v["verdict"] in ("ok", "unknown"):
            if v:
                m.setdefault("metadata", {})["layer_check"] = v
            continue
        meta = dict(m.get("metadata") or {})
        meta["layer_check"] = v
        meta.setdefault("first_pass_score_before_layer", m["confidence_score"])
        if v["verdict"] == "confirmed" and m["confidence_score"] >= 0.55:
            # The image is a fair match and it sits on this symbol's own layer: count it
            m["confidence_score"] = round(max(m["confidence_score"], auto_high), 3)
            m["status"] = "ai_unverified"
            stats["confirmed"] += 1
        elif v["verdict"] == "off":
            m["confidence_score"] = round(max(0.0, m["confidence_score"] - 0.35), 3)
            m["status"] = "needs_review"
            stats["down"] += 1
        elif v["verdict"] == "elsewhere":
            m["confidence_score"] = round(max(0.0, m["confidence_score"] - 0.2), 3)
            m["status"] = "needs_review"
            stats["down"] += 1
        m["metadata"] = meta
    return stats


def _clusters(paths, layer: str, gap: float = 6.0) -> List[List[float]]:
    """Groups of strokes on one layer that touch or nearly touch: one group per drawn item."""
    boxes = [list(p[:4]) for p in paths if p[4] == layer]
    merged = True
    while merged:
        merged = False
        out: List[List[float]] = []
        for b in boxes:
            for o in out:
                if b[0] <= o[2] + gap and o[0] <= b[2] + gap and b[1] <= o[3] + gap and o[1] <= b[3] + gap:
                    o[:] = [min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3])]
                    merged = True
                    break
            else:
                out.append(b)
        boxes = out
    return boxes


def possible_missed(marks: List[Dict[str, Any]], paths, know: LayerKnowledge, counted_at: float = 0.8) -> List[Dict[str, Any]]:
    """Symbol-sized items on a layer that holds only one symbol, with no counted mark on them.

    Returns new marks (status "possible_missed", score 0.5) for a person to look at. A weaker mark of the
    same symbol already sitting there is flagged instead of adding a second one."""
    found: List[Dict[str, Any]] = []
    for L in know.electrical_layers():
        owners = know.by_layer[L]
        sym, n = owners.most_common(1)[0]
        if n / sum(owners.values()) < SPECIFIC_SHARE:
            continue  # mixed layer (e.g. SERVICES with sockets, switches and spurs): can't tell which item is missing
        strong = [m for m in marks if m["confidence_score"] >= STRONG and know.g(m["legend_id"]) == sym]
        if not strong:
            continue
        w = sorted(max(m["width"], m["height"]) for m in strong)[len(strong) // 2]
        for c in _clusters(paths, L):
            size = max(c[2] - c[0], c[3] - c[1])
            if not (0.5 * w <= size <= 1.6 * w):
                continue
            cx, cy = (c[0] + c[2]) / 2, (c[1] + c[3]) / 2
            here = [m for m in marks if m["x"] - 6 <= cx <= m["x"] + m["width"] + 6 and m["y"] - 6 <= cy <= m["y"] + m["height"] + 6]
            if any(m["confidence_score"] >= counted_at for m in here):
                continue
            note = f'Drawn on the "{L}" layer, where only this symbol is drawn, but not counted'
            weak = [m for m in here if know.g(m["legend_id"]) == sym]
            if weak:
                m = max(weak, key=lambda x: x["confidence_score"])
                m["status"] = "possible_missed"
                m.setdefault("metadata", {})["layer_check"] = {"layer": L, "verdict": "missed", "note": note}
                continue
            tpl = strong[0]
            found.append({
                "legend_id": tpl["legend_id"],
                "x": round(cx - tpl["width"] / 2, 1), "y": round(cy - tpl["height"] / 2, 1),
                "width": tpl["width"], "height": tpl["height"],
                "confidence_score": 0.5, "status": "possible_missed",
                "metadata": {"layer_check": {"layer": L, "verdict": "missed", "note": note}, "source": "layer_gap"},
            })
    return found
