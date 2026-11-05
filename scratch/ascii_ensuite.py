import cv2
import numpy as np

img = cv2.imread('scratch/ensuite_true_socket.png')
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
red_mask = (((hsv[:, :, 0] < 18) | (hsv[:, :, 0] > 162)) & (hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 60))

for r in range(0, img.shape[0], 2):
    line = ""
    for c in range(0, img.shape[1], 2):
        if red_mask[r, c]:
            line += "#"
        elif np.mean(img[r, c]) < 100:
            line += "."
        else:
            line += " "
    print(line)
