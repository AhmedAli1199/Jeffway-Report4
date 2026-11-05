import cv2
import fitz
import sys
sys.path.append('backend')
from app.api.projects import get_sample_files

doc = fitz.open(get_sample_files()[0])
page = doc[24] # page 25
mat = page.rotation_matrix * fitz.Matrix(200/72, 200/72)

# Check 'shav' text location in 200dpi pixels:
for r in page.search_for('shav'):
    p0 = r.tl * mat
    p1 = r.br * mat
    print(f"Text 'shav' in pixels: ({p0.x:.1f}, {p0.y:.1f}) to ({p1.x:.1f}, {p1.y:.1f})")

img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
# Crop ensuite area around x=2000..2400, y=500..900
ensuite = img[500:900, 1950:2450]
cv2.imwrite('scratch/ensuite_full.png', ensuite)
print("Saved scratch/ensuite_full.png")
