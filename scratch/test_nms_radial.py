import numpy as np

def non_max_suppression_fast(
    boxes: np.ndarray, 
    overlap_thresh: float = 0.35, 
    center_dist_ratio: float = 0.70
):
    if len(boxes) == 0:
        return []

    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    scores = boxes[:, 4]

    w = x2 - x1 + 1
    h = y2 - y1 + 1
    area = w * h
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    min_dim = np.minimum(w, h)

    idxs = np.argsort(scores)
    pick = []

    while len(idxs) > 0:
        last = len(idxs) - 1
        i = idxs[last]
        pick.append(i)

        xx1 = np.maximum(x1[i], x1[idxs[:last]])
        yy1 = np.maximum(y1[i], y1[idxs[:last]])
        xx2 = np.minimum(x2[i], x2[idxs[:last]])
        yy2 = np.minimum(y2[i], y2[idxs[:last]])

        inter_w = np.maximum(0, xx2 - xx1 + 1)
        inter_h = np.maximum(0, yy2 - yy1 + 1)
        inter_area = inter_w * inter_h

        smaller_area = np.minimum(area[i], area[idxs[:last]])
        overlap = inter_area / np.maximum(1.0, smaller_area)

        dx = cx[i] - cx[idxs[:last]]
        dy = cy[i] - cy[idxs[:last]]
        dist = np.sqrt(dx * dx + dy * dy)
        dist_thresh = center_dist_ratio * np.minimum(min_dim[i], min_dim[idxs[:last]])

        suppress = (overlap > overlap_thresh) | (dist < dist_thresh)
        idxs = np.delete(idxs, np.concatenate(([last], np.where(suppress)[0])))

    return pick

# Test with simulated coaxial candidates like in user's screenshot:
# Candidate 1: Main peak (69%), 30x30 at (100, 100)
# Candidate 2: Shifted peak (57%), 30x30 at (88, 103) (shifted left by 12px, down 3px)
# Candidate 3: Distinct symbol in another room at (450, 600) (65%), 30x30
boxes = np.array([
    [100, 100, 130, 130, 0.69, 0],
    [88, 103, 118, 133, 0.57, 180],
    [450, 600, 480, 630, 0.65, 0]
])

pick = non_max_suppression_fast(boxes)
print(f"Total picked: {len(pick)}")
for p in pick:
    print("Picked box:", boxes[p])
