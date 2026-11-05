import cv2
import json
import numpy as np
from pathlib import Path
from PIL import Image

state = json.load(open('backend/data/projects/proj_avebury_curo/state.json'))
shave = next(l for l in state['legends'] if 'Shave' in l['label'])
crop_coords = shave['template_crop_coords']
print("Shave crop coords:", crop_coords)

# Load cached or rendered page image
cached_img_path = Path('backend/data/cache/The Avebury_p24_200dpi.png')
if not cached_img_path.exists():
    import glob
    candidates = list(Path('backend/data').glob('*p24*.png'))
    print("Candidates:", candidates)
    if candidates:
        cached_img_path = candidates[0]

img_bgr = cv2.imread(str(cached_img_path))
print("Page image shape:", img_bgr.shape)

# Extract template
tx, ty, tw, th = int(crop_coords['x']), int(crop_coords['y']), int(crop_coords['width']), int(crop_coords['height'])
template_bgr = img_bgr[ty:ty+th, tx:tx+tw]
cv2.imwrite('scratch/shave_template.png', template_bgr)
print(f"Saved scratch/shave_template.png ({tw}x{th})")

# Let's inspect the colors in the template:
hsv = cv2.cvtColor(template_bgr, cv2.COLOR_BGR2HSV)
# Non-white pixels:
non_white = (template_bgr[:, :, 0] < 235) | (template_bgr[:, :, 1] < 235) | (template_bgr[:, :, 2] < 235)
s_vals = hsv[:, :, 1][non_white]
h_vals = hsv[:, :, 0][non_white]
print(f"Template foreground pixels: {len(s_vals)}")
if len(s_vals) > 0:
    print(f"Mean Saturation: {np.mean(s_vals):.1f}, Max Saturation: {np.max(s_vals)}, Median S: {np.median(s_vals)}")
    print(f"High saturation (>50) fraction: {np.mean(s_vals > 50):.2f}")

# Now crop the bathroom area around x=1500..2000, y=1200..1600
bathroom_bgr = img_bgr[1200:1650, 1450:2050]
cv2.imwrite('scratch/bathroom_area.png', bathroom_bgr)
print("Saved scratch/bathroom_area.png")
