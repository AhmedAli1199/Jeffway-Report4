"""
Which room each mark is in, read from the CAD file, and room rules built on it (IP downlights in wet rooms).

The electrical plans keep the walls, doors and windows on their own CAD layers and the room names as
text ("Bath", "Ensuite", "Wc", "Bed 1"). We draw only those lines, thicken them to close door openings,
and every enclosed area is one room, named by the room label inside it.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import fitz
import numpy as np

from app.services.modifiers import sheet_words

WALL_LAYER = re.compile(r"WALL|DOOR|WINDOW|PLASTER|PARTITION", re.I)
ROOM_WORD = re.compile(
    r"\b(bath(room)?|bed(room)?|kitchen|living|lounge|dining|family|hall(way)?|landing|w\.?c|cloak(room)?|"
    r"en[- ]?suite|shower( room)?|utility|store|study|lobby|snug|garage|porch|entrance)\b( ?\d+)?",
    re.I,
)
RULES_FILE = Path(__file__).resolve().parents[2] / "data" / "room_rules.json"
DEFAULT_RULES = [{
    "name": "IP downlights in wet rooms",
    "symbols": ["sym_downlight_std", "sym_downlight_ip"],
    "in_rooms": "sym_downlight_ip",
    "elsewhere": "sym_downlight_std",
    "rooms": ["bath(room)?", "en[- ]?suite", "shower( room)?", "w\\.?c", "cloak(room)?"],
}]


def load_rules() -> List[Dict[str, Any]]:
    try:
        return json.loads(RULES_FILE.read_text())
    except Exception:
        return DEFAULT_RULES


def _arc_centre(p0, p1, p2, p3):
    """Centre of a circular arc drawn as a cubic Bezier: where the normals at its two ends meet."""
    t0 = (p1.x - p0.x, p1.y - p0.y)
    t1 = (p3.x - p2.x, p3.y - p2.y)
    # p0 + a*(-t0.y, t0.x) == p3 + b*(-t1.y, t1.x)
    ax, ay, bx, by = -t0[1], t0[0], -t1[1], t1[0]
    det = ax * (-by) - (-bx) * ay
    if abs(det) < 1e-9:
        return None
    dx, dy = p3.x - p0.x, p3.y - p0.y
    a = (dx * (-by) - (-bx) * dy) / det
    c = fitz.Point(p0.x + a * ax, p0.y + a * ay)
    r0, r1 = abs(c - p0), abs(c - p3)
    if r0 == 0 or abs(r0 - r1) > 0.2 * r0 or r0 > 80:
        return None  # not a circular door swing
    return c


@lru_cache(maxsize=16)
def sheet_rooms(pdf: str, page_index: int, dpi: int = 200):
    """(area id per pixel, {area id: room name}, [(x, y, name) of each label]), or None without wall layers / room names."""
    k = dpi / 72.0
    with fitz.open(pdf) as doc:
        page = doc[page_index]
        rot = page.rotation_matrix
        W, H = int(page.rect.width * k) + 1, int(page.rect.height * k) + 1
        walls = np.zeros((H, W), np.uint8)
        n = 0
        for d in page.get_drawings():
            if not WALL_LAYER.search(d.get("layer") or ""):
                continue
            for it in d["items"]:
                if it[0] == "l":
                    pts = [it[1], it[2]]
                elif it[0] == "re":
                    r = it[1]
                    pts = [r.tl, r.tr, r.br, r.bl, r.tl]
                elif it[0] == "qu":
                    q = it[1]
                    pts = [q.ul, q.ur, q.lr, q.ll, q.ul]
                elif it[0] == "c":
                    # a door swing: draw both radii from the hinge, one of which closes the doorway
                    hinge = _arc_centre(it[1], it[2], it[3], it[4])
                    pts = [it[1], hinge, it[4]] if hinge is not None else [it[1], it[4]]
                else:
                    continue
                pts = [(int((p * rot).x * k), int((p * rot).y * k)) for p in pts]
                for a, b in zip(pts, pts[1:]):
                    cv2.line(walls, a, b, 255, 3)
                    n += 1
    if n < 50:
        return None
    walls = cv2.dilate(walls, np.ones((9, 9), np.uint8))  # closes door openings
    _, areas = cv2.connectedComponents(255 - walls)

    words = sheet_words(pdf, page_index, dpi)
    lines: Dict[Tuple[int, int], List] = {}
    for w in words:
        lines.setdefault((w[5], w[6]), []).append(w)
    names: Dict[int, str] = {}
    labels: List[Tuple[int, int, str]] = []
    outside = {int(areas[0, 0]), int(areas[H - 1, W - 1])}
    for ws in lines.values():
        text = " ".join(w[4] for w in ws)
        m = ROOM_WORD.search(text)
        if not m or len(text) > 40:
            continue  # notes that mention a room ("light to bathroom ceiling") aren't room labels
        x = int(sum((w[0] + w[2]) / 2 for w in ws) / len(ws))
        y = int(sum((w[1] + w[3]) / 2 for w in ws) / len(ws))
        if not (0 <= x < W and 0 <= y < H):
            continue
        a = int(areas[y, x])
        if a == 0:  # the label sits on a drawn line (a bath outline, a hatch): take the area around it
            win = areas[max(0, y - 20):y + 21, max(0, x - 20):x + 21]
            vals, counts = np.unique(win[win > 0], return_counts=True)
            a = int(vals[counts.argmax()]) if len(vals) else 0
        if a == 0 or a in outside or (areas == a).sum() > 0.25 * W * H:
            continue
        names.setdefault(a, m.group(0).strip().title())
        labels.append((x, y, m.group(0).strip().title()))
    if not names:
        return None
    return areas, names, labels


NEAR_LABEL = 320  # px at 200 dpi: about 2 m at 1:50


def room_at(rooms, x: float, y: float) -> Optional[str]:
    """The named area a point is in; for an unnamed part of a room (split by a bath or a boxing-in line),
    the nearest room label within about 2 m."""
    areas, names, labels = rooms
    h, w = areas.shape
    xi, yi = int(x), int(y)
    if not (0 <= xi < w and 0 <= yi < h):
        return None
    a = int(areas[yi, xi])
    if a in names:
        return names[a]
    if a == 0 or (areas == a).sum() > 0.25 * w * h:
        return None
    near = min(labels, key=lambda l: (l[0] - x) ** 2 + (l[1] - y) ** 2, default=None)
    if near and ((near[0] - x) ** 2 + (near[1] - y) ** 2) ** 0.5 <= NEAR_LABEL:
        return near[2]
    return None


def apply(pdf: str, page_index: int, marks: List[Dict[str, Any]], library_ids=None) -> Dict[str, int]:
    """Set each mark's room and apply the room rules. Returns {"rooms": marks placed, "rule": marks changed}."""
    stats = {"rooms": 0, "rule": 0}
    try:
        rooms = sheet_rooms(pdf, page_index)
    except Exception:
        rooms = None
    if not rooms:
        return stats
    rules = load_rules()
    for m in marks:
        r = room_at(rooms, m["x"] + m["width"] / 2, m["y"] + m["height"] / 2)
        if not r:
            continue
        m["room"] = r
        stats["rooms"] += 1
        for rule in rules:
            if m["legend_id"] not in rule["symbols"]:
                continue
            wet = any(re.fullmatch(p + r"( ?\d+)?", r, re.I) for p in rule["rooms"])
            target = rule["in_rooms"] if wet else rule["elsewhere"]
            if target != m["legend_id"] and (library_ids is None or target in library_ids):
                meta = dict(m.get("metadata") or {})
                meta["room_rule"] = {"rule": rule["name"], "from": m["legend_id"], "room": r}
                m["metadata"] = meta
                m["legend_id"] = target
                stats["rule"] += 1
    return stats
