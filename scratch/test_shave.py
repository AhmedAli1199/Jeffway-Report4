import json
from pathlib import Path
import sys
sys.path.append('backend')
from app.services.pdf_service import PDFService
from app.vision.template_matcher import GeometricVisionMatcher
from app.api.projects import get_sample_files

state = json.load(open('backend/data/projects/proj_avebury_curo/state.json'))
shave = next(l for l in state['legends'] if 'Shave' in l['label'])
sample_pdfs = get_sample_files()
pdf_path = sample_pdfs[0]
print('PDF path:', pdf_path)

for p in [23, 24]:
    img_path, w, h = PDFService.render_page_image(pdf_path, p, dpi=200)
    matches = GeometricVisionMatcher.match_symbol(
        full_image_path=str(img_path),
        template_crop_coords=shave['template_crop_coords'],
        legend_id=shave['legend_id'],
        scales=[0.9, 1.0, 1.1],
        angles=[0, 90, 180, 270],
        min_confidence=0.50,
        exclude_source_box=True
    )
    print(f"Page index {p} (Sheet {p+1}): Total matches = {len(matches)}")
    for i, m in enumerate(matches):
        print(f"  Match {i+1}: score={m['confidence_score']}, x={m['x']}, y={m['y']}, angle={m['angle']}")
