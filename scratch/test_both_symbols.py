import json
import cv2
import numpy as np
import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image, non_max_suppression_fast

state = json.load(open('backend/data/projects/proj_avebury_curo/state.json'))
legends = state['legends']
img_bgr = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
h_max, w_max, _ = img_bgr.shape

def test_match(legend_name):
    leg = next(l for l in legends if legend_name.lower() in l['label'].lower())
    crop_coords = leg['template_crop_coords']
    tx = int(crop_coords["x"])
    ty = int(crop_coords["y"])
    tw = int(crop_coords["width"])
    th = int(crop_coords["height"])
    template_raw = img_bgr[ty : ty + th, tx : tx + tw]

    # Auto-tighten: find foreground bounds
    fg_mask = (template_raw[:, :, 0] < 235) | (template_raw[:, :, 1] < 235) | (template_raw[:, :, 2] < 235)
    if np.any(fg_mask):
        y_idx, x_idx = np.where(fg_mask)
        pad = 2
        y1_t = max(0, y_idx.min() - pad)
        y2_t = min(template_raw.shape[0], y_idx.max() + 1 + pad)
        x1_t = max(0, x_idx.min() - pad)
        x2_t = min(template_raw.shape[1], x_idx.max() + 1 + pad)
        template_bgr = template_raw[y1_t:y2_t, x1_t:x2_t]
    else:
        template_bgr = template_raw

    # Color analysis
    tpl_hsv = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2HSV)
    tpl_fg = (template_bgr[:, :, 0] < 235) | (template_bgr[:, :, 1] < 235) | (template_bgr[:, :, 2] < 235)
    tpl_s = tpl_hsv[:, :, 1][tpl_fg] if np.any(tpl_fg) else np.array([])
    is_chromatic = len(tpl_s) > 0 and np.mean(tpl_s > 45) > 0.25

    # Topology analysis
    th_t, tw_t = template_bgr.shape[:2]
    inner_y1, inner_y2 = int(th_t * 0.22), int(th_t * 0.78)
    inner_x1, inner_x2 = int(tw_t * 0.22), int(tw_t * 0.78)
    tpl_inner = tpl_fg[inner_y1:inner_y2, inner_x1:inner_x2] if np.any(tpl_fg) else np.array([])
    tpl_inner_density = float(np.mean(tpl_inner)) if tpl_inner.size > 0 else 0.0

    print(f"\n--- {leg['label']} ---")
    print(f"Original crop: {tw}x{th} -> Tight: {template_bgr.shape[1]}x{template_bgr.shape[0]}")
    print(f"Is Chromatic: {is_chromatic} (mean S: {np.mean(tpl_s):.1f})")
    print(f"Inner density: {tpl_inner_density:.3f}")

    img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    tpl_gray = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2GRAY)
    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV) if is_chromatic else None

    scales = [0.9, 0.95, 1.0, 1.05, 1.1]
    angles = [0, 90, 180, 270]
    all_candidates = []

    for angle in angles:
        rot_tpl = rotate_image(tpl_gray, angle)
        rh, rw = rot_tpl.shape
        for scale in scales:
            new_w = max(8, int(rw * scale))
            new_h = max(8, int(rh * scale))
            scaled_tpl = cv2.resize(rot_tpl, (new_w, new_h))
            cur_h, cur_w = scaled_tpl.shape
            if cur_h >= h_max or cur_w >= w_max:
                continue
            
            res = cv2.matchTemplate(img_gray, scaled_tpl, cv2.TM_CCOEFF_NORMED)
            locs = np.where(res >= 0.45)
            
            for pt_y, pt_x in zip(locs[0], locs[1]):
                raw_score = float(res[pt_y, pt_x])
                x1 = float(pt_x)
                y1 = float(pt_y)
                x2 = float(pt_x + cur_w)
                y2 = float(pt_y + cur_h)
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0
                
                if cx > w_max * 0.78 and cy > h_max * 0.76:
                    continue
                if (tx <= cx <= tx + tw) and (ty <= cy <= ty + th):
                    continue
                    
                cand_bgr = img_bgr[int(y1):int(y2), int(x1):int(x2)]
                if cand_bgr.shape[0] < 5 or cand_bgr.shape[1] < 5:
                    continue
                    
                cand_fg = (cand_bgr[:, :, 0] < 235) | (cand_bgr[:, :, 1] < 235) | (cand_bgr[:, :, 2] < 235)
                cy1, cy2 = int(cur_h * 0.22), int(cur_h * 0.78)
                cx1, cx2 = int(cur_w * 0.22), int(cur_w * 0.78)
                cand_inner = cand_fg[cy1:cy2, cx1:cx2]
                cand_inner_density = float(np.mean(cand_inner)) if cand_inner.size > 0 else 0.0
                
                topology_penalty = 1.0
                if tpl_inner_density > 0.12 and cand_inner_density < 0.04:
                    topology_penalty = 0.5
                elif tpl_inner_density < 0.04 and cand_inner_density > 0.20:
                    topology_penalty = 0.65
                    
                color_factor = 1.0
                if is_chromatic and img_hsv is not None:
                    cand_hsv = img_hsv[int(y1):int(y2), int(x1):int(x2)]
                    cand_s = cand_hsv[:, :, 1][cand_fg]
                    if len(cand_s) > 0:
                        sat_ratio = float(np.mean(cand_s > 40))
                        if sat_ratio < 0.15:
                            color_factor = 0.35
                        else:
                            color_factor = min(1.0, 0.75 + 0.25 * sat_ratio)
                    else:
                        color_factor = 0.35
                        
                final_score = raw_score * topology_penalty * color_factor
                if final_score >= 0.50:
                    all_candidates.append([x1, y1, x2, y2, final_score, angle])

    if all_candidates:
        arr = np.array(all_candidates)
        pick = non_max_suppression_fast(arr[:, :5], overlap_thresh=0.35)
        print(f"Matches after NMS >= 0.50: {len(pick)}")
        for i in pick[:5]:
            b = arr[i]
            print(f"  Score={b[4]:.3f}, x={b[0]:.1f}, y={b[1]:.1f}, angle={int(b[5])}")

test_match("Shave Socket")
test_match("Switch simple")
