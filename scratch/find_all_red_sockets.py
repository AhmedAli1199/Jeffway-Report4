import cv2
import numpy as np

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
red_mask = (((hsv[:, :, 0] < 18) | (hsv[:, :, 0] > 162)) & (hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 60)).astype(np.uint8) * 255

num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(red_mask)
print(f"Total red components on sheet: {num_labels}")

# Let's find rectangular shapes with size roughly 20..45 px
candidates = []
for i in range(1, num_labels):
    w = stats[i, cv2.CC_STAT_WIDTH]
    h = stats[i, cv2.CC_STAT_HEIGHT]
    area = stats[i, cv2.CC_STAT_AREA]
    x = stats[i, cv2.CC_STAT_LEFT]
    y = stats[i, cv2.CC_STAT_TOP]
    if 18 <= w <= 45 and 18 <= h <= 45 and area > 100:
        candidates.append((x, y, w, h, area))
        print(f"Candidate: x={x}, y={y}, w={w}, h={h}, area={area}")

# Save crops
for idx, (x, y, w, h, area) in enumerate(candidates):
    crop = img[max(0, y-10):min(img.shape[0], y+h+10), max(0, x-10):min(img.shape[1], x+w+10)]
    cv2.imwrite(f'scratch/red_candidate_{idx}.png', crop)
