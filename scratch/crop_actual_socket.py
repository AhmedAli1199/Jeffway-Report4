import cv2

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
# Crop around x=1740, y=1383
socket_crop = img[1370:1430, 1720:1780]
cv2.imwrite('scratch/actual_socket_p24.png', socket_crop)
print("Saved scratch/actual_socket_p24.png, shape:", socket_crop.shape)

template = cv2.imread('scratch/shave_template.png')
print("Template shape:", template.shape)
