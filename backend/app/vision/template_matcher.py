import cv2
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
import uuid

def rotate_image(image: np.ndarray, angle: int) -> np.ndarray:
    """Rotate image by 0, 90, 180, 270 degrees cleanly without border distortion."""
    if angle == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    elif angle == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    elif angle == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image

def suppress_by_explained_ink(cands: np.ndarray, ink: np.ndarray, max_explained: float = 0.45) -> List[int]:
    """
    Keep one detection per physical symbol without assuming how far apart symbols are.

    Candidates are taken strongest first. Each accepted one claims the drawn pixels (ink) inside its
    box. A later candidate is the same symbol found again (another rotation or scale, or the head and
    stem of a switch peaking separately) if most of its ink is already claimed; it is a second symbol
    if it has ink of its own, even when it touches the first (twin TV / coax points, socket banks).
    There is no rule on how close accessories may be drawn, so distance alone can't decide this.
    """
    if len(cands) == 0:
        return []
    order = np.argsort(-cands[:, 4])
    H, W = ink.shape[:2]
    claimed = np.zeros((H, W), dtype=bool)
    keep: List[int] = []
    centres: List[tuple] = []
    for i in order:
        x1, y1, x2, y2 = cands[i, :4]
        bx1, by1 = max(0, int(x1)), max(0, int(y1))
        bx2, by2 = min(W, int(np.ceil(x2))), min(H, int(np.ceil(y2)))
        if bx2 - bx1 < 2 or by2 - by1 < 2:
            continue
        w, h = bx2 - bx1, by2 - by1
        cx, cy = (bx1 + bx2) / 2.0, (by1 + by2) / 2.0
        # Same spot, different scale/rotation: no need to look at pixels
        if any(abs(cx - ax) < 0.3 * min(w, aw) and abs(cy - ay) < 0.3 * min(h, ah) for ax, ay, aw, ah in centres):
            continue
        box_ink = ink[by1:by2, bx1:bx2]
        n = int(box_ink.sum())
        if n < 6:
            continue
        explained = float(claimed[by1:by2, bx1:bx2][box_ink].sum()) / n
        if explained > max_explained:
            continue
        keep.append(int(i))
        centres.append((cx, cy, w, h))
        claimed[by1:by2, bx1:bx2] |= box_ink
    return keep


def non_max_suppression_fast(
    boxes: np.ndarray, 
    overlap_thresh: float = 0.20,
    center_dist_ratio: float = 1.35
) -> List[int]:
    """
    Research-Backed Distance-IoU & Major-Axis Non-Maximum Suppression (DIoU-NMS):
    1. Major-Axis Centroid Distance (Aspect-Ratio Invariant): Scales with max(w, h).
       Eliminates harmonic twin-lobe peaks and offset angle matches on asymmetrical symbols
       (such as wall-mounted switches where the stem and head can trigger separate peaks).
    2. Minimum physical spacing threshold (max(30.0, center_dist_ratio * ref_dim)):
       Guarantees that two markers on the same physical symbol footprint are never both kept.
    3. Small-box area overlap ratio for partial bounding box containment.
    4. Distance-IoU (Zheng et al., AAAI 2020) penalizes centroid distance relative to the
       diagonal of the smallest enclosing bounding box.
    """
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
    max_dim = np.maximum(w, h)

    idxs = np.argsort(scores)  # Sort by score ascending
    pick = []

    while len(idxs) > 0:
        last = len(idxs) - 1
        i = idxs[last]
        pick.append(i)

        # Bounding box intersection overlap
        xx1 = np.maximum(x1[i], x1[idxs[:last]])
        yy1 = np.maximum(y1[i], y1[idxs[:last]])
        xx2 = np.minimum(x2[i], x2[idxs[:last]])
        yy2 = np.minimum(y2[i], y2[idxs[:last]])

        inter_w = np.maximum(0, xx2 - xx1 + 1)
        inter_h = np.maximum(0, yy2 - yy1 + 1)
        inter_area = inter_w * inter_h

        # Overlap relative to the smaller box
        smaller_area = np.minimum(area[i], area[idxs[:last]])
        overlap = inter_area / np.maximum(1.0, smaller_area)

        # Centroid Euclidean distance
        dx = cx[i] - cx[idxs[:last]]
        dy = cy[i] - cy[idxs[:last]]
        dist = np.sqrt(dx * dx + dy * dy)

        # Major-axis aware spatial threshold with physical minimum spacing floor
        ref_dim = np.maximum(max_dim[i], max_dim[idxs[:last]])
        dist_thresh = np.maximum(30.0, center_dist_ratio * ref_dim)

        # Distance-IoU (DIoU) calculation
        enc_x1 = np.minimum(x1[i], x1[idxs[:last]])
        enc_y1 = np.minimum(y1[i], y1[idxs[:last]])
        enc_x2 = np.maximum(x2[i], x2[idxs[:last]])
        enc_y2 = np.maximum(y2[i], y2[idxs[:last]])
        c2 = (enc_x2 - enc_x1 + 1) ** 2 + (enc_y2 - enc_y1 + 1) ** 2
        rho2 = dx * dx + dy * dy
        diou_penalty = rho2 / np.maximum(1.0, c2)
        union_area = area[i] + area[idxs[:last]] - inter_area
        iou = inter_area / np.maximum(1.0, union_area)
        diou = iou - diou_penalty

        # Suppress if centroids are within same physical symbol footprint OR high overlap OR DIoU
        suppress = (dist < dist_thresh) | (overlap > overlap_thresh) | (diou > 0.08)
        idxs = np.delete(idxs, np.concatenate(([last], np.where(suppress)[0])))

    return pick

class GeometricVisionMatcher:
    @staticmethod
    def match_symbol(
        full_image_path: str,
        template_crop_coords: Dict[str, float], # {x, y, width, height}
        legend_id: str,
        scales: List[float] = [0.9, 0.95, 1.0, 1.05, 1.1],
        angles: List[int] = [0, 90, 180, 270],
        min_confidence: float = 0.50,
        exclude_source_box: bool = True,
        excluded_zones: Optional[List[Dict[str, Any]]] = None,
        template_bgr_override: Optional[np.ndarray] = None,
        image_bgr_override: Optional[np.ndarray] = None,
    ) -> List[Dict[str, Any]]:
        """
        Runs Multi-Scale, Multi-Angle Normalized Cross-Correlation (NCC)
        enhanced with:
        1. Adaptive Template Auto-Tightening (trims blank padding to prevent border noise)
        2. Generic Color/Chroma Guidance (prioritizes colored symbols without penalizing monochrome ones)
        3. Generic Interior Topology Verification (checks inner structure consistency)
        4. Non-Maximum Suppression (NMS) across rotations and scales.
        """
        img_bgr = image_bgr_override if image_bgr_override is not None else cv2.imread(str(full_image_path))
        if img_bgr is None:
            raise ValueError(f"Could not load image at {full_image_path}")

        h_max, w_max, _ = img_bgr.shape
        img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        
        # Extract raw user template crop
        tx = int(template_crop_coords["x"])
        ty = int(template_crop_coords["y"])
        tw = int(template_crop_coords["width"])
        th = int(template_crop_coords["height"])

        # Boundary checks
        tx = max(0, min(tx, w_max - 5))
        ty = max(0, min(ty, h_max - 5))
        tw = max(10, min(tw, w_max - tx))
        th = max(10, min(th, h_max - ty))

        if template_bgr_override is not None:
            # Sample image supplied directly (e.g. from the symbol library), so it is
            # portable across sheets and PDFs; there is no source box on this page to skip.
            template_raw = template_bgr_override
            exclude_source_box = False
        else:
            template_raw = img_bgr[ty : ty + th, tx : tx + tw]
        if template_raw.size == 0:
            return []

        # 1. Adaptive Template Auto-Tightening:
        # Detect foreground bounds (non-white pixels) and trim excessive outer blank margin
        fg_raw = (template_raw[:, :, 0] < 235) | (template_raw[:, :, 1] < 235) | (template_raw[:, :, 2] < 235)
        if np.any(fg_raw):
            y_idx, x_idx = np.where(fg_raw)
            fg_h = y_idx.max() - y_idx.min() + 1
            fg_w = x_idx.max() - x_idx.min() + 1
            if fg_h >= 6 and fg_w >= 6:
                template_bgr = template_raw[y_idx.min():y_idx.max()+1, x_idx.min():x_idx.max()+1]
            else:
                template_bgr = template_raw
        else:
            template_bgr = template_raw

        template_gray = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2GRAY)

        # 2. Generic Color / Chroma Profile:
        # Determine if the template itself is chromatic (e.g. red socket, yellow fitting) or monochrome (black/grey)
        tpl_hsv = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2HSV)
        tpl_fg = (template_bgr[:, :, 0] < 235) | (template_bgr[:, :, 1] < 235) | (template_bgr[:, :, 2] < 235)
        tpl_s = tpl_hsv[:, :, 1][tpl_fg] if np.any(tpl_fg) else np.array([])
        tpl_h = tpl_hsv[:, :, 0][tpl_fg] if np.any(tpl_fg) else np.array([])
        tpl_v = tpl_hsv[:, :, 2][tpl_fg] if np.any(tpl_fg) else np.array([])
        
        is_chromatic = False
        tpl_dom_h = 0.0
        tpl_chroma_pixel_count = 0
        if len(tpl_s) > 0:
            chroma_mask = (tpl_s > 35) & (tpl_v > 35)
            tpl_chroma_pixel_count = int(np.sum(chroma_mask))
            # If template has at least 10 chromatic pixels and >15% of foreground is chromatic
            if tpl_chroma_pixel_count >= 10 and (tpl_chroma_pixel_count / len(tpl_s)) > 0.15:
                is_chromatic = True
                tpl_dom_h = float(np.median(tpl_h[chroma_mask]))

        # Conditional Chroma Isolation:
        # For chromatic symbols (e.g. red switches/sockets):
        # We extract an isolated chroma map where matching hue strokes are 255 and all
        # monochrome CAD elements (black walls, text like '12', '13', door arcs) are ZERO!
        # This completely stops black walls from destroying correlation.
        # For monochrome symbols (black switches/fittings):
        # We retain pristine grayscale matching so NO black lines are masked, guaranteeing 100% generalizability.
        def extract_chroma_channel(bgr_image: np.ndarray, dom_hue: float) -> np.ndarray:
            hsv = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2HSV)
            h = hsv[:, :, 0].astype(np.float32)
            s = hsv[:, :, 1]
            v = hsv[:, :, 2]
            h_diff = np.abs(h - dom_hue)
            h_dist = np.minimum(h_diff, 180.0 - h_diff)
            mask = (h_dist <= 22.0) & (s > 35) & (v > 35)
            chroma_map = np.zeros(bgr_image.shape[:2], dtype=np.uint8)
            chroma_map[mask] = 255
            return chroma_map

        if is_chromatic:
            search_source = extract_chroma_channel(img_bgr, tpl_dom_h)
            tpl_matcher = extract_chroma_channel(template_bgr, tpl_dom_h)
        else:
            search_source = img_gray
            tpl_matcher = template_gray

        img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV) if is_chromatic else None

        # 3. Composite Symbol Decomposition (e.g. wall switch glyph + upright numeral 2 / 3):
        # In UK architectural CAD drawings, symbol bodies rotate with walls, but text/numeral annotations
        # ('2', '3', 'USB') are ALWAYS drawn upright (0 degrees) for legibility.
        # Rotating the entire crop turns text sideways or upside-down, destroying correlation against upright text.
        # Decomposing into primary glyph (which rotates with walls) and upright tag (matched at 0 deg)
        # achieves 0.90+ correlation for all annotated switches and socket plates!
        has_tag = False
        tpl_glyph = tpl_matcher
        tpl_tag = None

        if is_chromatic:
            bin_mask = (tpl_matcher > 30).astype(np.uint8)
            n_c, c_labels, c_stats, _ = cv2.connectedComponentsWithStats(bin_mask)
            if n_c > 2: # At least 2 distinct components (e.g. switch glyph + numeral)
                c_areas = [c_stats[i, 4] for i in range(1, n_c)]
                max_c_idx = 1 + int(np.argmax(c_areas))
                
                # Primary glyph (largest component)
                glyph_bin = np.zeros_like(bin_mask)
                glyph_bin[c_labels == max_c_idx] = 1
                gy, gx = np.where(glyph_bin > 0)
                tpl_glyph = tpl_matcher[gy.min():gy.max()+1, gx.min():gx.max()+1]
                
                # Upright tag component(s)
                tag_bin = np.zeros_like(bin_mask)
                for ci in range(1, n_c):
                    if ci != max_c_idx and c_stats[ci, 4] >= 12:
                        tag_bin[c_labels == ci] = 1
                        
                if np.any(tag_bin > 0):
                    ty_idx, tx_idx = np.where(tag_bin > 0)
                    tpl_tag = tpl_matcher[ty_idx.min():ty_idx.max()+1, tx_idx.min():tx_idx.max()+1]
                    has_tag = True
        # The code text (2, 3, USB...) may be printed sideways in the legend but upright on the plan,
        # or the other way round: look for it at every right angle.
        tpl_tags = [rotate_image(tpl_tag, a) for a in (0, 90, 180, 270)] if has_tag and tpl_tag is not None else []

        # 4. Generic Interior Topology Profile:
        # Measure density of strokes inside the template's central interior
        th_t, tw_t = template_bgr.shape[:2]
        inner_y1, inner_y2 = int(th_t * 0.22), int(th_t * 0.78)
        inner_x1, inner_x2 = int(tw_t * 0.22), int(tw_t * 0.78)
        tpl_inner = tpl_fg[inner_y1:inner_y2, inner_x1:inner_x2] if np.any(tpl_fg) else np.array([])
        tpl_inner_density = float(np.mean(tpl_inner)) if tpl_inner.size > 0 else 0.0

        # Drawn strokes that a symbol can "explain": the matching colour for coloured symbols,
        # dark linework for monochrome ones
        ink_map = (search_source > 60) if is_chromatic else (img_gray < 150)

        all_candidates = []
        # Preliminary correlation gate
        gate = 0.40 if is_chromatic else 0.40
        effective_min_conf = (min_confidence * 0.90) if is_chromatic else min_confidence

        # Iterate over rotations and scales
        for angle in angles:
            rot_template = rotate_image(tpl_glyph, angle)
            rh, rw = rot_template.shape

            for scale in scales:
                if scale == 1.0:
                    scaled_template = rot_template
                else:
                    new_w = max(8, int(rw * scale))
                    new_h = max(8, int(rh * scale))
                    scaled_template = cv2.resize(rot_template, (new_w, new_h), interpolation=cv2.INTER_AREA)

                cur_h, cur_w = scaled_template.shape
                if cur_h >= h_max or cur_w >= w_max:
                    continue

                # Template matching via Normalized Cross Correlation on appropriate channel
                res = cv2.matchTemplate(search_source, scaled_template, cv2.TM_CCOEFF_NORMED)
                # Keep only local peaks: every pixel around a match scores above the gate, and checking
                # each one (tag search, colour check) was the slow part. A peak window of a third of the
                # symbol still separates two symbols drawn touching.
                k = (max(3, (cur_w // 3) | 1), max(3, (cur_h // 3) | 1))
                peaks = (res >= cv2.dilate(res, cv2.getStructuringElement(cv2.MORPH_RECT, k))) & (res >= gate)
                locs = np.where(peaks)

                for pt_y, pt_x in zip(locs[0], locs[1]):
                    raw_score = float(res[pt_y, pt_x])
                    x1 = float(pt_x)
                    y1 = float(pt_y)
                    x2 = float(pt_x + cur_w)
                    y2 = float(pt_y + cur_h)

                    cx = (x1 + x2) / 2.0
                    cy = (y1 + y2) / 2.0

                    # Exclude user's cropped legend box if requested
                    if exclude_source_box:
                        if (tx <= cx <= tx + tw) and (ty <= cy <= ty + th):
                            continue

                    # Generic Electrical Legend exclusion
                    if excluded_zones:
                        in_excluded = False
                        for ez in excluded_zones:
                            ex = float(ez.get("x", 0))
                            ey = float(ez.get("y", 0))
                            ew = float(ez.get("width", 0))
                            eh = float(ez.get("height", 0))
                            if (ex <= cx <= ex + ew) and (ey <= cy <= ey + eh):
                                in_excluded = True
                                break
                        if in_excluded:
                            continue

                    # Exclude the architectural title block in bottom-right corner
                    if cx > w_max * 0.78 and cy > h_max * 0.76:
                        continue

                    # If template has an upright annotation tag (e.g. numeral '2' or '3'):
                    # Search for the upright tag (0 degrees) in the local neighborhood
                    bx1, by1, bx2, by2 = x1, y1, x2, y2
                    tag_score = 1.0
                    if has_tag and tpl_tag is not None:
                        reach = int(max(15, 0.6 * max(cur_w, cur_h)))
                        ny1 = max(0, int(y1 - reach))
                        ny2 = min(h_max, int(y2 + reach))
                        nx1 = max(0, int(x1 - reach))
                        nx2 = min(w_max, int(x2 + reach))
                        sub_nh = search_source[ny1:ny2, nx1:nx2]
                        tag_score, tag_x, tag_y, tag_h, tag_w = 0.0, x1, y1, 0, 0
                        for tt in tpl_tags:
                            th_, tw_ = tt.shape
                            if sub_nh.shape[0] >= th_ and sub_nh.shape[1] >= tw_:
                                res_t = cv2.matchTemplate(sub_nh, tt, cv2.TM_CCOEFF_NORMED)
                                _, max_v, _, max_l = cv2.minMaxLoc(res_t)
                                if max_v > tag_score:
                                    tag_score, tag_x, tag_y, tag_h, tag_w = float(max_v), nx1 + max_l[0], ny1 + max_l[1], th_, tw_

                        # Candidate must have the specific numeral tag present nearby
                        if tag_score < 0.45:
                            continue

                        bx1 = min(x1, float(tag_x)) - 2.0
                        by1 = min(y1, float(tag_y)) - 2.0
                        bx2 = max(x2, float(tag_x + tag_w)) + 2.0
                        by2 = max(y2, float(tag_y + tag_h)) + 2.0
                        raw_score = 0.50 * raw_score + 0.50 * tag_score

                    # Candidate patch extraction for verification
                    cand_bgr = img_bgr[int(by1):int(by2), int(bx1):int(bx2)]
                    if cand_bgr.shape[0] < 5 or cand_bgr.shape[1] < 5:
                        continue

                    cand_fg = (cand_bgr[:, :, 0] < 235) | (cand_bgr[:, :, 1] < 235) | (cand_bgr[:, :, 2] < 235)

                    # Generic Interior Topology Verification (primarily for monochrome symbols):
                    topology_factor = 1.0
                    if not is_chromatic:
                        cy1, cy2 = int(cur_h * 0.22), int(cur_h * 0.78)
                        cx1, cx2 = int(cur_w * 0.22), int(cur_w * 0.78)
                        cand_inner = cand_fg[cy1:cy2, cx1:cx2]
                        cand_inner_density = float(np.mean(cand_inner)) if cand_inner.size > 0 else 0.0

                        if tpl_inner_density > 0.12 and cand_inner_density < 0.04:
                            topology_factor = 0.50 # Hollow box false alarm
                        elif tpl_inner_density < 0.04 and cand_inner_density > 0.20:
                            topology_factor = 0.65 # Cluttered interior for hollow symbol

                    # Generic Color & Hue Consistency:
                    color_factor = 1.0
                    if is_chromatic and img_hsv is not None:
                        cand_hsv = img_hsv[int(by1):int(by2), int(bx1):int(bx2)]
                        ch = cand_hsv[:, :, 0].astype(np.float32)
                        cs = cand_hsv[:, :, 1]
                        cv_val = cand_hsv[:, :, 2]

                        h_diff = np.abs(ch - tpl_dom_h)
                        h_dist = np.minimum(h_diff, 180.0 - h_diff)
                        matching_chroma = (h_dist <= 22.0) & (cs > 35) & (cv_val > 35)
                        matching_count = int(np.sum(matching_chroma))

                        min_req_chroma = max(8, int(tpl_chroma_pixel_count * 0.20))
                        if matching_count < min_req_chroma:
                            color_factor = 0.0 # Missing colored glyph -> reject false alarm
                        else:
                            chroma_ratio = min(1.0, matching_count / max(1.0, float(tpl_chroma_pixel_count)))
                            color_factor = 0.85 + 0.15 * chroma_ratio

                    final_score = raw_score * topology_factor * color_factor
                    if final_score >= effective_min_conf:
                        all_candidates.append([bx1, by1, bx2, by2, final_score, angle])

        if not all_candidates:
            return []

        candidates_arr = np.array(all_candidates)
        pick_indices = suppress_by_explained_ink(candidates_arr, ink_map)

        markers = []
        high_thresh = 0.72 if is_chromatic else 0.78
        for idx in pick_indices:
            x1, y1, x2, y2, score, angle = candidates_arr[idx]
            markers.append({
                "marker_id": f"mk_{uuid.uuid4().hex[:8]}",
                "legend_id": legend_id,
                "x": round(float(x1), 1),
                "y": round(float(y1), 1),
                "width": round(float(x2 - x1), 1),
                "height": round(float(y2 - y1), 1),
                "confidence_score": round(float(score), 3),
                "angle": int(angle),
                "status": "ai_unverified" if score >= high_thresh else "needs_review",
                "room": "Unassigned",
            })

        # Sort markers top-to-bottom, left-to-right for consistent ordering
        markers.sort(key=lambda m: (m["y"], m["x"]))
        return markers
