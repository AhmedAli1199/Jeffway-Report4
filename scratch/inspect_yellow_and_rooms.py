import cv2
import numpy as np
import fitz

# Let's inspect the yellow candidate from the screenshot:
# In previous log: Match 1: score=0.591, x=1531.0, y=853.0, angle=90
# Match 2: score=0.564, x=1531.0, y=891.0, angle=90
img = cv2.imread('backend/data/cache/The Avebury_p24_200dpi.png')
crop_yellow = img[840:910, 1510:1560]
cv2.imwrite('scratch/crop_yellow.png', crop_yellow)
hsv_yellow = cv2.cvtColor(crop_yellow, cv2.COLOR_BGR2HSV)
print("Yellow crop mean H:", np.mean(hsv_yellow[:, :, 0]), "mean S:", np.mean(hsv_yellow[:, :, 1]))

# Now let's check shaver sockets on Page 25:
import sys
sys.path.append('backend')
from app.api.projects import get_sample_files
doc = fitz.open(get_sample_files()[0])
page = doc[24] # page 25
print("Page 25 text search for 'shav':", page.search_for('shav'))
print("Page 25 text search for 'socket':", len(page.search_for('socket')))

# Let's search for all red components on page 25 that are near bathrooms / ensuites:
# Where are the bathrooms and ensuites on page 25?
mat = page.rotation_matrix * fitz.Matrix(200/72, 200/72)
for room in ['Bathroom', 'En-suite', 'En Suite', 'Ensuite', 'Shower']:
    for r in page.search_for(room):
        pt0 = r.tl * mat
        pt1 = r.br * mat
        print(f"Room '{room}' at: ({pt0.x:.1f}, {pt0.y:.1f})")
