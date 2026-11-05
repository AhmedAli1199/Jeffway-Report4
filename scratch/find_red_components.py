import cv2
import numpy as np

bathroom = cv2.imread('scratch/bathroom_area.png')
hsv_bath = cv2.cvtColor(bathroom, cv2.COLOR_BGR2HSV)
red_mask = (((hsv_bath[:, :, 0] < 18) | (hsv_bath[:, :, 0] > 162)) & (hsv_bath[:, :, 1] > 70) & (hsv_bath[:, :, 2] > 60)).astype(np.uint8) * 255

num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(red_mask)
print(f"Number of red components: {num_labels}")
for i in range(1, num_labels):
    area = stats[i, cv2.CC_STAT_AREA]
    w = stats[i, cv2.CC_STAT_WIDTH]
    h = stats[i, cv2.CC_STAT_HEIGHT]
    x = stats[i, cv2.CC_STAT_LEFT]
    y = stats[i, cv2.CC_STAT_TOP]
    if area > 30: # ignore noise
        print(f"Component {i}: area={area}, x={x}, y={y}, w={w}, h={h} (page x={1450+x}, y={1200+y})")

# Look at the shaver socket from the user screenshot:
# It's next to the sink and bathtub at around x=1880, y=1340!
