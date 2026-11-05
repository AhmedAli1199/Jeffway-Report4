import cv2
import numpy as np

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
tight_tpl = cv2.imread('scratch/tight_tpl.png')

import sys
sys.path.append('backend')
from app.vision.template_matcher import rotate_image

gray_img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
gray_tpl = cv2.cvtColor(tight_tpl, cv2.COLOR_BGR2GRAY)

# Check around x=2290..2320, y=695..725
for angle in [0, 90, 180, 270]:
    rot_tpl = rotate_image(gray_tpl, angle)
    rw, rh = rot_tpl.shape[1], rot_tpl.shape[0]
    res = cv2.matchTemplate(gray_img[680:740, 2280:2340], rot_tpl, cv2.TM_CCOEFF_NORMED)
    min_v, max_v, min_l, max_l = cv2.minMaxLoc(res)
    print(f"Angle {angle}: max={max_v:.4f} at local loc={max_l} (page: x={2280+max_l[0]}, y={680+max_l[1]})")
