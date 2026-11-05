import cv2
import numpy as np

tight_tpl = cv2.imread('scratch/tight_tpl.png')
ensuite_socket = cv2.imread('scratch/ensuite_true_socket.png')

import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image

gray_ensuite = cv2.cvtColor(ensuite_socket, cv2.COLOR_BGR2GRAY)
gray_tpl = cv2.cvtColor(tight_tpl, cv2.COLOR_BGR2GRAY)

best_score = -1
best_info = ""
for angle in [0, 90, 180, 270]:
    rot_tpl = rotate_image(gray_tpl, angle)
    for scale in [0.85, 0.9, 0.95, 1.0, 1.05, 1.1]:
        rw = int(rot_tpl.shape[1] * scale)
        rh = int(rot_tpl.shape[0] * scale)
        if rw >= gray_ensuite.shape[1] or rh >= gray_ensuite.shape[0]:
            continue
        scaled_tpl = cv2.resize(rot_tpl, (rw, rh))
        res = cv2.matchTemplate(gray_ensuite, scaled_tpl, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, _ = cv2.minMaxLoc(res)
        if max_val > best_score:
            best_score = max_val
            best_info = f"Angle {angle}, Scale {scale:.2f}"
print(f"Ensuite Socket: Best Grayscale NCC Score = {best_score:.4f} ({best_info})")
