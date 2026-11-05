import cv2
import numpy as np

tight_tpl = cv2.imread('scratch/tight_tpl.png')
ensuite_shaver = cv2.imread('scratch/ensuite_shaver.png')

import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image

gray_shaver = cv2.cvtColor(ensuite_shaver, cv2.COLOR_BGR2GRAY)
gray_tpl = cv2.cvtColor(tight_tpl, cv2.COLOR_BGR2GRAY)

print("Tight tpl shape:", gray_tpl.shape)
print("Ensuite shaver shape:", gray_shaver.shape)

for angle in [0, 90, 180, 270]:
    rot_tpl = rotate_image(gray_tpl, angle)
    for scale in [0.85, 0.9, 0.95, 1.0, 1.05, 1.1]:
        rw = int(rot_tpl.shape[1] * scale)
        rh = int(rot_tpl.shape[0] * scale)
        if rw >= gray_shaver.shape[1] or rh >= gray_shaver.shape[0]:
            continue
        scaled_tpl = cv2.resize(rot_tpl, (rw, rh))
        res = cv2.matchTemplate(gray_shaver, scaled_tpl, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)
        if max_val > 0.35:
            print(f"Angle {angle}, Scale {scale:.2f} ({rw}x{rh}): max_val = {max_val:.4f} at {max_loc}")
