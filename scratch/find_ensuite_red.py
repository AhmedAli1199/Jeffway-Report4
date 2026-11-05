import cv2
import numpy as np

ensuite = cv2.imread('scratch/ensuite_full.png')
# Find any red pixels in ensuite
hsv = cv2.cvtColor(ensuite, cv2.COLOR_BGR2HSV)
red_mask = (((hsv[:, :, 0] < 18) | (hsv[:, :, 0] > 162)) & (hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 60)).astype(np.uint8) * 255

num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(red_mask)
print(f"Red components in ensuite area: {num_labels}")
for i in range(1, num_labels):
    area = stats[i, cv2.CC_STAT_AREA]
    if area > 10:
        x, y, w, h = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP], stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        print(f"  Component {i}: area={area}, x={1950+x}, y={500+y}, w={w}, h={h}")
        crop = ensuite[max(0, y-10):min(ensuite.shape[0], y+h+10), max(0, x-10):min(ensuite.shape[1], x+w+10)]
        cv2.imwrite(f'scratch/ensuite_red_{i}.png', crop)
