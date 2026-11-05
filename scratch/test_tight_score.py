import cv2
import numpy as np

tight_tpl = cv2.imread('scratch/tight_tpl.png')
actual = cv2.imread('scratch/actual_socket_p24.png')
toilet = cv2.imread('scratch/toilet_crop.png')

import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image

gray_actual = cv2.cvtColor(actual, cv2.COLOR_BGR2GRAY)
gray_toilet = cv2.cvtColor(toilet, cv2.COLOR_BGR2GRAY)
gray_tpl = cv2.cvtColor(tight_tpl, cv2.COLOR_BGR2GRAY)

print("Tight template shape:", gray_tpl.shape)

for name, target in [("Actual Socket", gray_actual), ("Toilet", gray_toilet)]:
    best_score = -1
    best_info = ""
    for angle in [0, 90, 180, 270]:
        rot_tpl = rotate_image(gray_tpl, angle)
        for scale in [0.85, 0.9, 0.95, 1.0, 1.05, 1.1]:
            rw = int(rot_tpl.shape[1] * scale)
            rh = int(rot_tpl.shape[0] * scale)
            if rw >= target.shape[1] or rh >= target.shape[0]:
                continue
            scaled_tpl = cv2.resize(rot_tpl, (rw, rh))
            res = cv2.matchTemplate(target, scaled_tpl, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, _ = cv2.minMaxLoc(res)
            if max_val > best_score:
                best_score = max_val
                best_info = f"Angle {angle}, Scale {scale:.2f}"
    print(f"{name}: Best Grayscale NCC Score = {best_score:.4f} ({best_info})")
