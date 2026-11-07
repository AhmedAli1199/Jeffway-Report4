"""
Stroke-pattern check: every copy of a CAD block is drawn with exactly the same strokes.

An architect places a symbol by pasting the same CAD block, so each real twin socket on a sheet is made
of the same paths (say 4 curves, 3 lines and 96 filled segments), whatever its position, size, rotation
or the wall line drawn through it. The image score can't see that; the PDF can.

Per tender we learn which stroke pattern each symbol is drawn with, from two sources:
  - the sheet's own legend: the glyph left of each legend row is the CAD block for that item;
  - strong first-pass matches (>= 0.85).
Then for each weaker mark:
  - its pattern belongs to its own symbol -> confirmed (counted, no AI);
  - its pattern belongs only to one other symbol -> moved to that symbol;
and every group of strokes with a known pattern that nothing marked is added as a found item.

Variants drawn with one block (1/2/3-way switch, twin / USB socket) share a pattern: that confirms the
mark is that kind of item, and the printed code (modifiers.py) decides which variant.
"""
from __future__ import annotations

import collections
from typing import Any, Dict, List, Optional, Set, Tuple

from app.services.cad_layers import STRONG, mark_layer

MIN_SEEN = 2        # strong matches with a pattern before we trust it (a legend glyph counts as enough)
MIN_PATHS = 2       # a single stroke (a lone circle) is too common to mean anything; a switch is a circle + a line
PAD = 4

Pattern = Tuple[Tuple[str, int], ...]


def _counts(paths, layer: str, x0: float, y0: float, x1: float, y1: float) -> collections.Counter:
    return collections.Counter(p[5] for p in paths if p[4] == layer and p[0] >= x0 and p[1] >= y0 and p[2] <= x1 and p[3] <= y1)


def fingerprint(box: Dict[str, float], paths, layer: Optional[str] = None, known=None) -> Optional[Tuple[str, Pattern]]:
    """(layer, pattern) of a box: the stroke-shape counts of the stroke groups centred inside it.

    Whole stroke groups are used, so a door line or a neighbour's toggle poking into the box doesn't
    change the pattern. Among the layers present, one whose pattern is already known wins."""
    x0, y0 = box["x"] - PAD, box["y"] - PAD
    x1, y1 = box["x"] + box["width"] + PAD, box["y"] + box["height"] + PAD
    size = max(box["width"], box["height"])
    per: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for L, b, c in sheet_clusters(paths):
        if layer and L != layer:
            continue
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if x0 <= cx <= x1 and y0 <= cy <= y1 and max(b[2] - b[0], b[3] - b[1]) <= 1.6 * size + 2 * PAD:
            per[L].update(c)
    best = None
    for L, c in per.items():
        if sum(c.values()) < MIN_PATHS:
            continue
        pat = tuple(sorted(c.items()))
        if known is not None and pat in known:
            return L, pat
        if best is None or sum(c.values()) > sum(dict(best[1]).values()):
            best = (L, pat)
    if known is not None:
        # A symbol touching a dimension line or cable on its own layer merges into one big stroke group.
        # Fall back to the strokes lying fully inside the box (long lines through it are not inside).
        layers = {p[4] for p in paths if p[4] and p[0] >= x0 and p[1] >= y0 and p[2] <= x1 and p[3] <= y1}
        for L in layers:
            c = _counts(paths, L, x0, y0, x1, y1)
            pat = tuple(sorted(c.items()))
            if sum(c.values()) >= MIN_PATHS and pat in known:
                return L, pat
    return best


def _clusters(paths, layer: Optional[str], gap: float = 3.0, region=None) -> List[Tuple[str, List[float]]]:
    """(layer, box) of each group of touching strokes on one layer (or every layer), optionally inside a region."""
    items = [p for p in paths if (layer is None and p[4]) or p[4] == layer]
    if region:
        rx0, ry0, rx1, ry1 = region
        items = [p for p in items if p[0] >= rx0 and p[1] >= ry0 and p[2] <= rx1 and p[3] <= ry1]
    n = len(items)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    cell = 40.0
    grid: Dict[Tuple[int, int], List[int]] = collections.defaultdict(list)
    for i, p in enumerate(items):
        for gx in range(int((p[0] - gap) // cell), int((p[2] + gap) // cell) + 1):
            for gy in range(int((p[1] - gap) // cell), int((p[3] + gap) // cell) + 1):
                grid[(gx, gy)].append(i)
    for ids in grid.values():
        for a_i in range(len(ids)):
            a = items[ids[a_i]]
            for b_i in range(a_i + 1, len(ids)):
                b = items[ids[b_i]]
                if a[4] == b[4] and a[0] <= b[2] + gap and b[0] <= a[2] + gap and a[1] <= b[3] + gap and b[1] <= a[3] + gap:
                    ra, rb = find(ids[a_i]), find(ids[b_i])
                    if ra != rb:
                        parent[ra] = rb
    boxes: Dict[int, List] = {}
    for i, p in enumerate(items):
        r = find(i)
        b = boxes.get(r)
        if b is None:
            boxes[r] = [p[4], [p[0], p[1], p[2], p[3]], collections.Counter({p[5]: 1})]
        else:
            b[1] = [min(b[1][0], p[0]), min(b[1][1], p[1]), max(b[1][2], p[2]), max(b[1][3], p[3])]
            b[2][p[5]] += 1
    return [(L, box, c) for L, box, c in boxes.values()]


_INDEX: Dict[int, List] = {}


def sheet_clusters(paths) -> List[Tuple[str, List[float], collections.Counter]]:
    """Every group of touching strokes on the sheet, per layer (cached per sheet)."""
    key = id(paths)
    if key not in _INDEX:
        if len(_INDEX) > 16:
            _INDEX.clear()
        _INDEX[key] = _clusters(paths, None)
    return _INDEX[key]


class ShapeKnowledge:
    """Stroke patterns learned from one tender's legends and strong matches."""

    def __init__(self, groups: Dict[str, str]):
        self.groups = groups
        self.seen: Dict[Pattern, collections.Counter] = collections.defaultdict(collections.Counter)   # strong matches
        self.legend: Dict[Pattern, Set[str]] = collections.defaultdict(set)                          # legend glyphs
        self.layers: Dict[Pattern, Set[str]] = collections.defaultdict(set)
        self.size: Dict[Pattern, List[float]] = collections.defaultdict(list)
        self.example: Dict[Tuple[Pattern, str], Dict[str, float]] = {}
        self.base: Set[str] = set()   # symbols drawn with no code beside them on the legend (the plain variant)
        self.letters: Dict[str, Set[str]] = collections.defaultdict(set)   # text inside a legend glyph -> symbols
        self.letter_size: Dict[str, List[float]] = collections.defaultdict(list)

    def g(self, legend_id: str) -> str:
        return self.groups.get(legend_id, legend_id)

    def _note(self, fp, sym: str, w: float, h: float) -> None:
        L, pat = fp
        self.layers[pat].add(L)
        self.size[pat].append(max(w, h))
        self.example.setdefault((pat, sym), {"width": w, "height": h})

    def learn(self, marks: List[Dict[str, Any]], paths) -> None:
        for m in marks:
            if m["confidence_score"] < STRONG or (m.get("metadata") or {}).get("modifier_check"):
                continue
            fp = fingerprint(m, paths)
            if fp:
                self.seen[fp[1]][self.g(m["legend_id"])] += 1
                self._note(fp, self.g(m["legend_id"]), m["width"], m["height"])

    def learn_legend(self, mods: Dict[str, Any], paths, words=()) -> int:
        """Read the glyph drawn left of each legend row of this sheet."""
        taught = 0
        for sid, codes in mods.get("by_symbol", {}).items():
            if not codes:
                self.base.add(self.g(sid))
        for sid, (x0, y0, y1) in (mods.get("row_boxes") or {}).items():
            h = max(12.0, y1 - y0)
            region = (x0 - 300, y0 - 1.5 * h, x0 - 1, y1 + 1.5 * h)
            rx0, ry0, rx1, ry1 = region
            cands = []
            for L, b, c in sheet_clusters(paths):
                cy = (b[1] + b[3]) / 2
                if b[0] >= rx0 and b[2] <= rx1 and b[1] >= ry0 and b[3] <= ry1 and y0 - 0.5 * h <= cy <= y1 + 0.5 * h:
                    cands.append((x0 - b[2], L, b, c))
            if not cands:
                continue
            cands.sort(key=lambda c: c[0])
            _, L, b, _ = cands[0]
            # a glyph can be several stroke groups (a socket's two halves): take the nearby ones on the same layer
            parts = [c for c in cands if c[1] == L and c[2][2] >= b[0] - 12]
            bx0 = min(c[2][0] for c in parts); by0 = min(c[2][1] for c in parts)
            bx1 = max(c[2][2] for c in parts); by1 = max(c[2][3] for c in parts)
            if max(bx1 - bx0, by1 - by0) > 160:
                continue
            # letters drawn inside the glyph (S = smoke, HD = heat, P = pendant ...): text in the CAD file
            inside = sorted((w for w in words if w[0] >= bx0 - 1 and w[2] <= bx1 + 1 and w[1] >= by0 - 1 and w[3] <= by1 + 1),
                            key=lambda w: w[0])
            text = "".join(w[4] for w in inside)
            if text and len(text) <= 3:
                self.letters[text].add(self.g(sid))
                self.letter_size[text].append(max(bx1 - bx0, by1 - by0))
            total = collections.Counter()
            for c in parts:
                total.update(c[3])
            if sum(total.values()) < MIN_PATHS:
                continue
            fp = (L, tuple(sorted(total.items())))
            self.legend[fp[1]].add(self.g(sid))
            self._note(fp, self.g(sid), bx1 - bx0, by1 - by0)
            taught += 1
        return taught

    def known(self) -> Set[Pattern]:
        return {p for p in set(self.seen) | set(self.legend) if self.owners(p)}

    @staticmethod
    def specific(pat: Pattern) -> bool:
        """Two straight strokes match half the drawing; a pattern needs 3+ strokes or a curve to mean anything."""
        return sum(n for _, n in pat) >= 3 or any("c" in k or "qu" in k or "re" in k for k, _ in pat)

    def owners(self, pat: Pattern) -> Set[str]:
        if not self.specific(pat):
            return set()
        out = set(self.legend.get(pat, set()))
        out |= {s for s, n in self.seen.get(pat, {}).items() if n >= MIN_SEEN}
        return out

    def apply(self, marks: List[Dict[str, Any]], paths, auto_high: float) -> Dict[str, int]:
        stats = {"confirmed": 0, "moved": 0}
        known = self.known()
        for m in marks:
            meta = m.get("metadata") or {}
            if m["confidence_score"] >= STRONG or m.get("status") == "possible_missed":
                continue
            fp = fingerprint(m, paths, known=known)
            if not fp:
                continue
            own = self.owners(fp[1])
            g = self.g(m["legend_id"])
            if not own:
                continue
            if g in own:
                mc = meta.get("modifier_check") or {}
                if (mc.get("extra") or mc.get("missing")) and not meta.get("relabelled_from"):
                    continue  # the code beside it says it's another variant: leave it to the code check / a person
                verdict, note = "confirmed", "Drawn with exactly the strokes of this symbol's CAD block"
            elif len(own) == 1 and not meta.get("modifier_check"):
                verdict, note = "moved", "Drawn with exactly the strokes of another symbol's CAD block"
            else:
                continue
            meta = dict(meta)
            meta["first_pass_score_before_shape"] = m["confidence_score"]
            meta["shape_check"] = {"verdict": verdict, "note": note, "from": m["legend_id"]}
            if verdict == "moved":
                m["legend_id"] = next(iter(own))
                stats["moved"] += 1
            else:
                stats["confirmed"] += 1
            if (meta.get("layer_check") or {}).get("verdict") in ("off", "elsewhere"):
                meta["layer_check"] = {**meta["layer_check"], "overruled": True}
            m["confidence_score"] = round(max(m["confidence_score"], auto_high), 3)
            m["status"] = "ai_unverified"
            m["metadata"] = meta
        return stats

    def find_missed(self, marks: List[Dict[str, Any]], paths, auto_high: float, counted_at: float = 0.8) -> List[Dict[str, Any]]:
        """Copies of a known block that no counted mark sits on."""
        pats = {}
        for pat in set(self.seen) | set(self.legend):
            own = self.owners(pat)
            if len(own) > 1:
                own = own & self.base   # one block, several variants: add it as the plain one; its code moves it
            if len(own) == 1:
                pats[pat] = next(iter(own))
        if not pats:
            return []
        out: List[Dict[str, Any]] = []
        # Candidate spots: each stroke group on a layer a known pattern is drawn on
        layers = {L for pat in pats for L in self.layers[pat]}
        spots = [(L, (c[0] + c[2]) / 2, (c[1] + c[3]) / 2, max(c[2] - c[0], c[3] - c[1])) for L, c, _ in sheet_clusters(paths) if L in layers]
        for L, ccx, ccy, extent in spots:
            hit = None
            for pat in (p for p in pats if L in self.layers[p]):
                med = sorted(self.size[pat])[len(self.size[pat]) // 2]
                if extent > 1.6 * med:
                    continue
                for dx, dy in ((0, 0), (0.3, 0), (-0.3, 0), (0, 0.3), (0, -0.3)):
                    probe = {"x": ccx - med / 2 + dx * med, "y": ccy - med / 2 + dy * med, "width": med, "height": med}
                    fp = fingerprint(probe, paths, L, known={pat})
                    if fp and fp[1] == pat:
                        hit = (pat, probe)
                        break
                if hit:
                    break
            if not hit:
                continue
            pat, probe = hit
            ccx, ccy = probe["x"] + probe["width"] / 2, probe["y"] + probe["height"] / 2
            sym = pats[pat]
            box = probe
            cx, cy = ccx, ccy
            if any(m["x"] - 4 <= cx <= m["x"] + m["width"] + 4 and m["y"] - 4 <= cy <= m["y"] + m["height"] + 4
                   and (m["confidence_score"] >= counted_at or self.g(m["legend_id"]) == sym) for m in marks + out):
                continue
            out.append({
                "legend_id": sym, "x": round(box["x"], 1), "y": round(box["y"], 1),
                "width": round(box["width"], 1), "height": round(box["height"], 1),
                "confidence_score": round(auto_high, 3), "status": "ai_unverified",
                "metadata": {"source": "shape_found", "shape_check": {
                    "verdict": "found", "note": "Missed by the image match, but drawn with exactly the strokes of this symbol's CAD block"}},
            })
        return out

    def apply_letters(self, marks: List[Dict[str, Any]], paths, words, auto_high: float, counted_at: float = 0.8) -> Dict[str, Any]:
        """Lettered symbols: a legend letter (S, HD, P, B ...) inside a drawn circle is that item.

        A weak mark of that item there is confirmed; a circle with the letter and no mark is added."""
        stats = {"confirmed": 0, "found": []}
        owners = {t: next(iter(s)) for t, s in self.letters.items() if len(s) == 1}
        if not owners:
            return stats
        for w in words:
            sym = owners.get(w[4])
            if not sym:
                continue
            cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
            size = sorted(self.letter_size[w[4]])[len(self.letter_size[w[4]]) // 2]
            ring = [p for p in paths if "c" in p[5] and p[0] <= cx <= p[2] and p[1] <= cy <= p[3]
                    and 0.6 * size <= max(p[2] - p[0], p[3] - p[1]) <= 1.8 * size]
            if not ring:
                continue  # the letter isn't in a circle: a note, a room code, not a symbol
            r = min(ring, key=lambda p: (p[2] - p[0]) * (p[3] - p[1]))
            here = [m for m in marks if m["x"] - 3 <= cx <= m["x"] + m["width"] + 3 and m["y"] - 3 <= cy <= m["y"] + m["height"] + 3]
            if any(m["confidence_score"] >= counted_at for m in here):
                continue
            mine = [m for m in here if self.g(m["legend_id"]) == sym]
            note = f'"{w[4]}" printed inside the circle: on this legend that letter marks this symbol'
            if mine:
                m = max(mine, key=lambda m: m["confidence_score"])
                meta = dict(m.get("metadata") or {})
                meta["first_pass_score_before_letter"] = m["confidence_score"]
                meta["letter_check"] = {"verdict": "confirmed", "note": note}
                m["metadata"] = meta
                m["confidence_score"] = round(max(m["confidence_score"], auto_high), 3)
                m["status"] = "ai_unverified"
                stats["confirmed"] += 1
                continue
            stats["found"].append({
                "legend_id": sym, "x": round(r[0], 1), "y": round(r[1], 1),
                "width": round(r[2] - r[0], 1), "height": round(r[3] - r[1], 1),
                "confidence_score": round(auto_high, 3), "status": "ai_unverified",
                "metadata": {"source": "letter_found", "letter_check": {"verdict": "found", "note": "Missed by the image match: " + note}},
            })
        return stats
