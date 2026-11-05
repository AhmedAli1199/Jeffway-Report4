import cv2
img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
ensuite_socket = img[730:785, 2115:2170]
cv2.imwrite('scratch/ensuite_true_socket.png', ensuite_socket)
print("Saved ensuite_true_socket.png")
