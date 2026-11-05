import requests
import json

state = json.load(open('backend/data/projects/proj_avebury_curo/state.json'))
shave = next(l for l in state['legends'] if 'Shave' in l['label'])

import sys
sys.path.append('backend')
from app.api.projects import get_sample_files

filepath = str(get_sample_files()[0])

payload = {
    "project_id": "proj_avebury_curo",
    "filepath": filepath,
    "page_index": 24, # Sheet 25
    "legend": shave,
    "dpi": 200,
    "min_confidence": 0.50,
    "angles": [0, 90, 180, 270]
}

res = requests.post("http://127.0.0.1:8008/api/takeoff/auto-count", json=payload)
print("Status code:", res.status_code)
data = res.json()
print("Total detected:", data.get("total_detected"))
for m in data.get("markers", []):
    print(f"  Score: {m['confidence_score']}, x: {m['x']}, y: {m['y']}, angle: {m['angle']}")
