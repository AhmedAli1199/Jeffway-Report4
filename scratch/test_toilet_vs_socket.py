import cv2
import numpy as np

# Load bathroom
bathroom = cv2.imread('scratch/bathroom_area.png') # y: 1200..1650, x: 1450..2050
template = cv2.imread('scratch/shave_template.png')

# The toilet cistern in bathroom coords is roughly y=1345-1200=145, x=1548-1450=98
toilet_crop = bathroom[100:220, 80:200]
cv2.imwrite('scratch/toilet_crop.png', toilet_crop)

# Let's inspect saturation in toilet_crop
toilet_hsv = cv2.cvtColor(toilet_crop, cv2.COLOR_BGR2HSV)
toilet_fg = (toilet_crop[:, :, 0] < 235) | (toilet_crop[:, :, 1] < 235) | (toilet_crop[:, :, 2] < 235)
toilet_s = toilet_hsv[:, :, 1][toilet_fg]
print(f"Toilet FG pixels: {len(toilet_s)}, Mean Saturation: {np.mean(toilet_s):.1f}, Fraction S > 50: {np.mean(toilet_s > 50):.2f}")

# Now find where red/orange pixels are in the bathroom area!
hsv_bath = cv2.cvtColor(bathroom, cv2.COLOR_BGR2HSV)
# Red in HSV wraps around 0/180: e.g. H < 15 or H > 165, and S > 70, V > 50
red_mask = ((hsv_bath[:, :, 0] < 18) | (hsv_bath[:, :, 0] > 162)) & (hsv_bath[:, :, 1] > 70) & (hsv_bath[:, :, 2] > 60)
red_pts = np.argwhere(red_mask)
print(f"Red pixels found in bathroom area: {len(red_pts)}")
if len(red_pts) > 0:
    min_y, min_x = red_pts.min(axis=0)
    max_y, max_x = red_pts.max(axis=0)
    print(f"Red bounding box in bathroom: y=[{min_y}, {max_y}], x=[{min_x}, {max_x}]")
    print(f"In page coords: y=[{1200+min_y}, {1200+max_y}], x=[{1450+min_x}, {1450+max_x}]")
    real_socket_crop = bathroom[min_y-10:max_y+10, min_x-10:max_x+10]
    cv2.imwrite('scratch/real_socket_crop.png', real_socket_crop)
    print(f"Saved scratch/real_socket_crop.png (shape {real_socket_crop.shape})")
