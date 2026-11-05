import cv2
import numpy as np
import json
import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image, non_max_suppression_fast

state = json.load(open('backend/data/projects/proj_avebury_curo/state.json'))
leg = next(l for l in state['legends'] if 'Switch simple' in l['label'])
crop_coords = leg['template_crop_coords']

img_bgr = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
h_max, w_max, _ = img_bgr.shape

tx, ty = int(crop_coords["x"]), int(crop_coords["y"])
tw, th = int(crop_coords["width"]), int(crop_coords["height"])
template_raw = img_bgr[ty : ty + th, tx : tx + tw]

# Exact zero-padding foreground tightening
fg_raw = (template_raw[:, :, 0] < 235) | (template_raw[:, :, 1] < 235) | (template_raw[:, :, 2] < 235)
if np.any(fg_raw):
    y_idx, x_idx = np.where(fg_raw)
    template_bgr = template_raw[y_idx.min():y_idx.max()+1, x_idx.min():x_idx.max()+1]
else:
    template_bgr = template_raw

print(f"Switch simple tight: {template_bgr.shape[1]}x{template_bgr.shape[0]}")

tpl_hsv = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2HSV)
tpl_fg = (template_bgr[:, :, 0] < 235) | (template_bgr[:, :, 1] < 235) | (template_bgr[:, :, 2] < 235)
tpl_s = tpl_hsv[:, :, 1][tpl_fg]
tpl_h = tpl_hsv[:, :, 0][tpl_fg]

is_chromatic = False
tpl_dom_h = 0.0
if len(tpl_s) > 0 and np.mean(tpl_s > 45) > 0.20:
    is_chromatic = True
    sat_mask = tpl_s > 45
    tpl_dom_h = float(np.median(tpl_h[sat_mask]))
    print(f"Chromatic! Dominant Hue: {tpl_dom_h:.1f}")
else:
    print("Monochrome.")

# Topology
th_t, tw_t = template_bgr.shape[:2]
inner_y1, inner_y2 = int(th_t * 0.22), int(th_t * 0.78)
inner_x1, inner_x2 = int(tw_t * 0.22), int(tw_t * 0.78)
tpl_inner = tpl_fg[inner_y1:inner_y2, inner_x1:inner_x2] if np.any(tpl_fg) else np.array([])
tpl_inner_density = float(np.mean(tpl_inner)) if tpl_inner.size > 0 else 0.0

img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
tpl_gray = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2GRAY)
img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV) if is_chromatic else None

scales = [0.9, 0.95, 1.0, 1.05, 1.1]
angles = [0, 90, 180, 270]
all_candidates = []

def circular_hue_dist(h1, h2):
    d = np.abs(h1 - h2)
    return np.minimum(d, 180 - d)

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
        locs = np.where(res >= 0.40)
        
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
            
            topology_factor = 1.0
            if tpl_inner_density > 0.12 and cand_inner_density < 0.04:
                topology_factor = 0.50
            elif tpl_inner_density < 0.04 and cand_inner_density > 0.20:
                topology_factor = 0.65
                
            color_factor = 1.0
            if is_chromatic and img_hsv is not None:
                cand_hsv = img_hsv[int(y1):int(y2), int(x1):int(x2)]
                cand_s = cand_hsv[:, :, 1][cand_fg]
                cand_h = cand_hsv[:, :, 0][cand_fg]
                if len(cand_s) > 0:
                    sat_mask = cand_s > 40
                    sat_ratio = float(np.mean(sat_mask))
                    if sat_ratio < 0.12:
                        color_factor = 0.0
                    else:
                        cand_sat_h = cand_h[sat_mask]
                        h_dists = circular_hue_dist(cand_sat_h, tpl_dom_h)
                        mean_h_dist = float(np.mean(h_dists))
                        if mean_h_dist > 18.0:
                            color_factor = 0.0
                        else:
                            hue_sim = max(0.0, 1.0 - (mean_h_dist / 18.0))
                            color_factor = 0.70 + 0.30 * hue_sim
                else:
                    color_factor = 0.0
                    
            final_score = raw_score * topology_factor * color_factor
            if final_score >= 0.50:
                all_candidates.append([x1, y1, x2, y2, final_score, angle])

if all_candidates:
    arr = np.array(all_candidates)
    pick = non_max_suppression_fast(arr[:, :5], overlap_thresh=0.35)
    print(f"Switch simple matches after NMS >= 0.50: {len(pick)}")
    for i in pick[:5]:
        b = arr[i]
        print(f"  Score={b[4]:.3f}, x={b[0]:.1f}, y={b[1]:.1f}, angle={int(b[5])}")
