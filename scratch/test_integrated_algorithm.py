import cv2
import numpy as np
import json
from pathlib import Path
import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image, non_max_suppression_fast

state = json.load(open('backend/data/projects/proj_avebury_curo/state.json'))
shave = next(l for l in state['legends'] if 'Shave' in l['label'])
crop_coords = shave['template_crop_coords']

img_bgr = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
h_max, w_max, _ = img_bgr.shape

# 1. User crop
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
    y1 = max(0, y_idx.min() - pad)
    y2 = min(template_raw.shape[0], y_idx.max() + 1 + pad)
    x1 = max(0, x_idx.min() - pad)
    x2 = min(template_raw.shape[1], x_idx.max() + 1 + pad)
    template_bgr = template_raw[y1:y2, x1:x2]
else:
    template_bgr = template_raw

print(f"Original crop: {tw}x{th} -> Auto-tightened: {template_bgr.shape[1]}x{template_bgr.shape[0]}")

# 2. Generic Color / Chroma Profile
tpl_hsv = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2HSV)
tpl_fg = (template_bgr[:, :, 0] < 235) | (template_bgr[:, :, 1] < 235) | (template_bgr[:, :, 2] < 235)
tpl_s = tpl_hsv[:, :, 1][tpl_fg]
tpl_h = tpl_hsv[:, :, 0][tpl_fg]

is_chromatic = False
dominant_hue = 0
if len(tpl_s) > 0 and np.mean(tpl_s > 50) > 0.25:
    is_chromatic = True
    # Find median hue of saturated pixels
    sat_mask = tpl_s > 50
    dominant_hue = float(np.median(tpl_h[sat_mask]))
    print(f"Symbol is CHROMATIC. Median S: {np.median(tpl_s):.1f}, Dominant H: {dominant_hue:.1f}")
else:
    print("Symbol is MONOCHROME / BLACK & WHITE.")

# 3. Generic Interior Topology Profile
th_t, tw_t, _ = template_bgr.shape
inner_y1, inner_y2 = int(th_t * 0.22), int(th_t * 0.78)
inner_x1, inner_x2 = int(tw_t * 0.22), int(tw_t * 0.78)
tpl_inner = tpl_fg[inner_y1:inner_y2, inner_x1:inner_x2]
tpl_inner_density = float(np.mean(tpl_inner)) if tpl_inner.size > 0 else 0.0
print(f"Template inner density: {tpl_inner_density:.3f} (has internal details: {tpl_inner_density > 0.12})")

# Run matching
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
        
        # Raw correlation
        res = cv2.matchTemplate(img_gray, scaled_tpl, cv2.TM_CCOEFF_NORMED)
        locs = np.where(res >= 0.45) # initial broad filter
        
        for pt_y, pt_x in zip(locs[0], locs[1]):
            raw_score = float(res[pt_y, pt_x])
            x1 = float(pt_x)
            y1 = float(pt_y)
            x2 = float(pt_x + cur_w)
            y2 = float(pt_y + cur_h)
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            
            # Skip title block
            if cx > w_max * 0.78 and cy > h_max * 0.76:
                continue
            # Skip source box
            if (tx <= cx <= tx + tw) and (ty <= cy <= ty + th):
                continue
                
            # Candidate patch
            cand_bgr = img_bgr[int(y1):int(y2), int(x1):int(x2)]
            if cand_bgr.shape[0] < 5 or cand_bgr.shape[1] < 5:
                continue
                
            # Topology check
            cand_fg = (cand_bgr[:, :, 0] < 235) | (cand_bgr[:, :, 1] < 235) | (cand_bgr[:, :, 2] < 235)
            cy1, cy2 = int(cur_h * 0.22), int(cur_h * 0.78)
            cx1, cx2 = int(cur_w * 0.22), int(cur_w * 0.78)
            cand_inner = cand_fg[cy1:cy2, cx1:cx2]
            cand_inner_density = float(np.mean(cand_inner)) if cand_inner.size > 0 else 0.0
            
            # If template has internal strokes but candidate is hollow:
            topology_penalty = 1.0
            if tpl_inner_density > 0.12 and cand_inner_density < 0.04:
                # Hollow box false positive!
                topology_penalty = 0.5
            elif tpl_inner_density < 0.04 and cand_inner_density > 0.20:
                # Template is hollow but candidate is cluttered/filled:
                topology_penalty = 0.7
                
            # Color check (only if template is chromatic!)
            color_factor = 1.0
            if is_chromatic:
                cand_hsv = img_hsv[int(y1):int(y2), int(x1):int(x2)]
                cand_s = cand_hsv[:, :, 1][cand_fg]
                if len(cand_s) > 0:
                    sat_ratio = float(np.mean(cand_s > 40))
                    # If candidate has zero saturation (pure black/grey CAD lines like toilet):
                    if sat_ratio < 0.15:
                        color_factor = 0.3 # severe penalty for black line on colored symbol!
                    else:
                        color_factor = 0.7 + 0.3 * sat_ratio
                else:
                    color_factor = 0.3
                    
            final_score = raw_score * topology_penalty * color_factor
            if final_score >= 0.50:
                all_candidates.append([x1, y1, x2, y2, final_score, angle])

print(f"Total candidates before NMS: {len(all_candidates)}")
if all_candidates:
    arr = np.array(all_candidates)
    pick = non_max_suppression_fast(arr[:, :5], overlap_thresh=0.35)
    print(f"Total candidates after NMS: {len(pick)}")
    for i in pick:
        box = arr[i]
        print(f"  Candidate: score={box[4]:.3f}, x={box[0]:.1f}, y={box[1]:.1f}, angle={int(box[5])}")
