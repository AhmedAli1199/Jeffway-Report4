import os
from pathlib import Path
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Load OPENAI_API_KEY etc. from the repo-root .env (or backend/.env) if present
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR.parent / ".env")
    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass
DATA_DIR = BASE_DIR / "data"
PROJECTS_DIR = DATA_DIR / "projects"
CACHE_DIR = DATA_DIR / "cache"
EXPORTS_DIR = DATA_DIR / "exports"

for d in [DATA_DIR, PROJECTS_DIR, CACHE_DIR, EXPORTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

class Settings(BaseModel):
    app_name: str = "Jeffway AI Electrical Takeoff & Estimation System"
    api_prefix: str = "/api"
    debug: bool = True
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    default_dpi: int = 200  # High-fidelity rasterization DPI for canvas and template matching
    thumbnail_dpi: int = 50

settings = Settings()
