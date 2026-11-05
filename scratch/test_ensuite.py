import cv2
import numpy as np

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
# Crop around x=2264, y=528
ensuite_crop = img[500:580, 2240:2320]
cv2.imwrite('scratch/ensuite_crop.png', ensuite_crop)

# Check red pixels in ensuite crop
hsv = cv2.cvtColor(ensuite_crop, cv2.COLOR_BGR2HSV)
red_mask = (((hsv[:, :, 0] < 18) | (hsv[:, :, 0] > 162)) & (hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 60))
print(f"Red pixels in ensuite crop: {np.sum(red_mask)}")
y_idx, x_idx = np.where(red_mask)
if len(y_idx) > 0:
    print(f"Red bounds in ensuite: y=[{500+y_idx.min()}, {500+y_idx.max()}], x=[{2240+x_idx.min()}, {2240+x_idx.max()}]")
