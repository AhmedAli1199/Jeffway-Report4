import cv2
import numpy as np

img = cv2.imread('scratch/ensuite_true_socket.png')
print("Image shape:", img.shape)
# Save enlarged version
big = cv2.resize(img, (200, 200), interpolation=cv2.INTER_NEAREST)
cv2.imwrite('scratch/ensuite_socket_large.png', big)
print("Saved ensuite_socket_large.png")
