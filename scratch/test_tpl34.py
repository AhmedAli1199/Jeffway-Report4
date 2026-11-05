import cv2
import numpy as np

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
# User crop for shave
crop_coords = {'x': 141.95, 'y': 1141.3, 'width': 51.97, 'height': 40.83}
tx, ty, tw, th = int(crop_coords['x']), int(crop_coords['y']), int(crop_coords['width']), int(crop_coords['height'])
template_raw = img[ty:ty+th, tx:tx+tw]

fg_raw = (template_raw[:, :, 0] < 235) | (template_raw[:, :, 1] < 235) | (template_raw[:, :, 2] < 235)
y_idx, x_idx = np.where(fg_raw)
pad = 2
y1_t = max(0, y_idx.min() - pad)
y2_t = min(template_raw.shape[0], y_idx.max() + 1 + pad)
x1_t = max(0, x_idx.min() - pad)
x2_t = min(template_raw.shape[1], x_idx.max() + 1 + pad)
tpl_34 = template_raw[y1_t:y2_t, x1_t:x2_t]

print(f"tpl_34 shape: {tpl_34.shape}")
gray_tpl = cv2.cvtColor(tpl_34, cv2.COLOR_BGR2GRAY)
gray_img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

res = cv2.matchTemplate(gray_img[680:740, 2280:2340], gray_tpl, cv2.TM_CCOEFF_NORMED)
min_v, max_v, min_l, max_l = cv2.minMaxLoc(res)
print(f"Match with tpl_34: max={max_v:.4f} at local loc={max_l} (page: x={2280+max_l[0]}, y={680+max_l[1]})")
