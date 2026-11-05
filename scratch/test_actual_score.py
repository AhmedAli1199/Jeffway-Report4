import cv2
import numpy as np

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
template = cv2.imread('scratch/shave_template.png')
actual_socket = cv2.imread('scratch/actual_socket_p24.png')

# Let's test matchTemplate of template against actual_socket across all angles and scales:
import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image

gray_actual = cv2.cvtColor(actual_socket, cv2.COLOR_BGR2GRAY)
gray_tpl = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)

print(f"gray_actual shape: {gray_actual.shape}, gray_tpl shape: {gray_tpl.shape}")

for angle in [0, 90, 180, 270]:
    rot_tpl = rotate_image(gray_tpl, angle)
    for scale in [0.7, 0.8, 0.9, 1.0, 1.1, 1.2]:
        rw = int(rot_tpl.shape[1] * scale)
        rh = int(rot_tpl.shape[0] * scale)
        if rw >= gray_actual.shape[1] or rh >= gray_actual.shape[0]:
            continue
        scaled_tpl = cv2.resize(rot_tpl, (rw, rh))
        res = cv2.matchTemplate(gray_actual, scaled_tpl, cv2.TM_CCOEFF_NORMED)
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)
        print(f"Angle {angle}, Scale {scale:.1f} ({rw}x{rh}): max_val = {max_val:.4f} at {max_loc}")
