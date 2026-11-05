import cv2
import json
import sys
sys.path.append('backend')
from app.vision.template_matcher import GeometricVisionMatcher

state = json.load(open('backend/data/projects/proj_avebury_curo/state.json'))
shave = next(l for l in state['legends'] if 'Shave' in l['label'])

# Run match_symbol with min_confidence=0.40 to see all candidates around 2302, 703
matches = GeometricVisionMatcher.match_symbol(
    full_image_path='backend/data/cache/The Avebury_p24_200dpi.png',
    template_crop_coords=shave['template_crop_coords'],
    legend_id=shave['legend_id'],
    scales=[0.9, 0.95, 1.0, 1.05, 1.1],
    angles=[0, 90, 180, 270],
    min_confidence=0.40,
    exclude_source_box=True
)

print(f"Total matches found >= 0.40: {len(matches)}")
for m in matches:
    if 2280 <= m['x'] <= 2320 and 680 <= m['y'] <= 730:
        print("FOUND ENSUITE SHAVER CANDIDATE:", m)
