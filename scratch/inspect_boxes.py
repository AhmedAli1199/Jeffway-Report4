import cv2
import numpy as np

template = cv2.imread('scratch/shave_template.png')
actual = cv2.imread('scratch/actual_socket_p24.png')

print("Template BGR shape:", template.shape)
print("Actual BGR shape:", actual.shape)

# Let's see what is inside the template:
# Print where non-white pixels are in the template:
h, w, _ = template.shape
fg_t = (template[:, :, 0] < 235) | (template[:, :, 1] < 235) | (template[:, :, 2] < 235)
print("Template FG bounding box:")
y_idx, x_idx = np.where(fg_t)
print(f"y: [{y_idx.min()}, {y_idx.max()}], x: [{x_idx.min()}, {x_idx.max()}]")
print(f"FG width: {x_idx.max() - x_idx.min() + 1}, FG height: {y_idx.max() - y_idx.min() + 1}")

# Let's also check the actual socket's red pixels:
hsv_act = cv2.cvtColor(actual, cv2.COLOR_BGR2HSV)
red_act = (((hsv_act[:, :, 0] < 18) | (hsv_act[:, :, 0] > 162)) & (hsv_act[:, :, 1] > 70) & (hsv_act[:, :, 2] > 60))
y_a, x_a = np.where(red_act)
print(f"Actual socket red FG bounding box:")
print(f"y: [{y_a.min()}, {y_a.max()}], x: [{x_a.min()}, {x_a.max()}]")
print(f"Red FG width: {x_a.max() - x_a.min() + 1}, Red FG height: {y_a.max() - y_a.min() + 1}")

# Let's save a visual comparison
tight_tpl = template[y_idx.min():y_idx.max()+1, x_idx.min():x_idx.max()+1]
tight_act = actual[y_a.min():y_a.max()+1, x_a.min():x_a.max()+1]
cv2.imwrite('scratch/tight_tpl.png', tight_tpl)
cv2.imwrite('scratch/tight_act.png', tight_act)
print(f"Tight tpl saved: {tight_tpl.shape}, Tight act saved: {tight_act.shape}")
