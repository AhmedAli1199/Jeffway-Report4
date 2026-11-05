import cv2
import numpy as np

# Shaver template
tpl = cv2.imread('scratch/tight_tpl.png') # Red
# Yellow candidate from screenshot
yellow = cv2.imread('scratch/crop_yellow.png') # Yellow
# Real bathroom socket
real_bath = cv2.imread('scratch/actual_socket_p24.png') # Red
# Real ensuite shaver
ensuite_shaver = cv2.imread('scratch/ensuite_shaver.png') # Red

def get_color_profile(bgr):
    fg = (bgr[:, :, 0] < 235) | (bgr[:, :, 1] < 235) | (bgr[:, :, 2] < 235)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    fg_h = hsv[:, :, 0][fg]
    fg_s = hsv[:, :, 1][fg]
    fg_v = hsv[:, :, 2][fg]
    return fg_h, fg_s, fg_v

tpl_h, tpl_s, _ = get_color_profile(tpl)
# Dominant template hue (circular mean or median for red)
# For red wrapping around 180:
def circular_hue_dist(h1, h2):
    d = np.abs(h1 - h2)
    return np.minimum(d, 180 - d)

tpl_sat_mask = tpl_s > 50
tpl_dom_h = np.median(tpl_h[tpl_sat_mask])
print(f"Template Dominant Hue: {tpl_dom_h:.1f}, Median Saturation: {np.median(tpl_s):.1f}")

for name, img in [("Bathroom Socket (Real)", real_bath), ("Ensuite Shaver (Real)", ensuite_shaver), ("Yellow Light (False)", yellow)]:
    ch, cs, _ = get_color_profile(img)
    sat_mask = cs > 40
    if np.sum(sat_mask) == 0:
        print(f"{name}: ZERO saturated pixels (Monochrome CAD line)")
    else:
        cand_h = ch[sat_mask]
        # Distance from template dominant hue
        hue_dists = circular_hue_dist(cand_h, tpl_dom_h)
        mean_hue_dist = np.mean(hue_dists)
        # Hue match: 0 distance is 1.0, 15 degrees is 0.5, > 25 degrees is 0.0
        hue_match = max(0.0, 1.0 - (mean_hue_dist / 20.0))
        sat_ratio = np.mean(cs > 40)
        color_match = hue_match * sat_ratio
        print(f"{name}: Mean Hue Dist = {mean_hue_dist:.1f}, Hue Match = {hue_match:.3f}, Sat Ratio = {sat_ratio:.3f} -> Color Score = {color_match:.3f}")
