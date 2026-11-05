import cv2
import numpy as np

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
# candidate was at x=2300, y=712, w=34, h=34
cand_bgr = img[712:746, 2300:2334]
cand_fg = (cand_bgr[:, :, 0] < 235) | (cand_bgr[:, :, 1] < 235) | (cand_bgr[:, :, 2] < 235)
cy1, cy2 = int(34 * 0.22), int(34 * 0.78)
cx1, cx2 = int(34 * 0.22), int(34 * 0.78)
cand_inner = cand_fg[cy1:cy2, cx1:cx2]
cand_inner_density = float(np.mean(cand_inner))
print(f"Cand inner density at (2300, 712): {cand_inner_density:.3f}")

# What was the color factor?
hsv = cv2.cvtColor(cand_bgr, cv2.COLOR_BGR2HSV)
cand_s = hsv[:, :, 1][cand_fg]
print(f"Cand mean S: {np.mean(cand_s):.1f}, ratio S > 40: {np.mean(cand_s > 40):.3f}")

# And what about the yellow candidate from the user screenshot at (1531, 853)?
yellow_bgr = img[853:853+34, 1531:1531+34]
y_fg = (yellow_bgr[:, :, 0] < 235) | (yellow_bgr[:, :, 1] < 235) | (yellow_bgr[:, :, 2] < 235)
y_hsv = cv2.cvtColor(yellow_bgr, cv2.COLOR_BGR2HSV)
y_h = y_hsv[:, :, 0][y_fg]
y_s = y_hsv[:, :, 1][y_fg]
print(f"Yellow candidate mean H: {np.mean(y_h):.1f}, mean S: {np.mean(y_s):.1f}, ratio S > 40: {np.mean(y_s > 40):.3f}")
