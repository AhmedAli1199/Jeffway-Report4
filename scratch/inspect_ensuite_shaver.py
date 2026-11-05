import cv2
import numpy as np

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
ensuite_shaver = img[695:745, 2290:2345]
cv2.imwrite('scratch/ensuite_shaver.png', ensuite_shaver)
print("Saved ensuite_shaver.png, shape:", ensuite_shaver.shape)

hsv = cv2.cvtColor(ensuite_shaver, cv2.COLOR_BGR2HSV)
red_mask = (((hsv[:, :, 0] < 18) | (hsv[:, :, 0] > 162)) & (hsv[:, :, 1] > 70) & (hsv[:, :, 2] > 60))

for r in range(0, ensuite_shaver.shape[0], 2):
    line = ""
    for c in range(0, ensuite_shaver.shape[1], 2):
        if red_mask[r, c]:
            line += "#"
        elif np.mean(ensuite_shaver[r, c]) < 120:
            line += "."
        else:
            line += " "
    print(line)
