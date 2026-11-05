import cv2
import numpy as np

tight_tpl = cv2.imread('scratch/tight_tpl.png')
actual = cv2.imread('scratch/actual_socket_p24.png')
toilet = cv2.imread('scratch/toilet_crop.png')

import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image

# 1. Color analysis of template
tpl_hsv = cv2.cvtColor(tight_tpl, cv2.COLOR_BGR2HSV)
# Non-white pixels
fg_mask = (tight_tpl[:, :, 0] < 235) | (tight_tpl[:, :, 1] < 235) | (tight_tpl[:, :, 2] < 235)
fg_s = tpl_hsv[:, :, 1][fg_mask]
is_chromatic = np.mean(fg_s > 50) > 0.30
print(f"Is template chromatic? {is_chromatic} (mean S={np.mean(fg_s):.1f})")

# If chromatic, let's look at saturation or color channel distance:
# In actual socket vs toilet:
def evaluate_candidate(cand_bgr):
    cand_hsv = cv2.cvtColor(cand_bgr, cv2.COLOR_BGR2HSV)
    cand_fg = (cand_bgr[:, :, 0] < 235) | (cand_bgr[:, :, 1] < 235) | (cand_bgr[:, :, 2] < 235)
    if not np.any(cand_fg):
        return 0.0, 0.0
    cand_s = cand_hsv[:, :, 1][cand_fg]
    # Chromatic match score: how many FG pixels have high saturation
    chroma_score = float(np.mean(cand_s > 40))
    
    # Interior density check:
    # Inner 50% box of candidate
    ch, cw, _ = cand_bgr.shape
    y1, y2 = int(ch * 0.25), int(ch * 0.75)
    x1, x2 = int(cw * 0.25), int(cw * 0.75)
    inner_fg = cand_fg[y1:y2, x1:x2]
    inner_density = float(np.mean(inner_fg))
    return chroma_score, inner_density

# Inner density of tight_tpl:
th, tw, _ = tight_tpl.shape
tpl_inner = fg_mask[int(th*0.25):int(th*0.75), int(tw*0.25):int(tw*0.75)]
tpl_inner_density = float(np.mean(tpl_inner))
print(f"Template inner density: {tpl_inner_density:.3f}")

# Extract best candidate patches from actual and toilet
# Actual best was at Angle 270 (so rotated 270: 30x30)
# In actual_socket (60x60): centered around (35, 30)
act_patch = actual[14:44, 20:50]
toilet_patch = toilet[10:40, 30:60]

act_chroma, act_inner = evaluate_candidate(act_patch)
toilet_chroma, toilet_inner = evaluate_candidate(toilet_patch)

print(f"Actual Socket: Chroma Score = {act_chroma:.3f}, Inner Density = {act_inner:.3f}")
print(f"Toilet Cistern: Chroma Score = {toilet_chroma:.3f}, Inner Density = {toilet_inner:.3f}")
