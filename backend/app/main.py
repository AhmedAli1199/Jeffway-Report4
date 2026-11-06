from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.core.config import settings, CACHE_DIR
from app.api.projects import router as projects_router
from app.api.takeoff import router as takeoff_router
from app.api.exports import router as exports_router
from app.api.ai_assistant import router as ai_router
from app.api.symbols import router as symbols_router
from app.api.tenders import router as tenders_router

app = FastAPI(
    title="Jeffway AI Electrical Takeoff Engine",
    description="Automated architectural blueprint electrical estimating and symbol takeoff system",
    version="1.0.0"
)

# CORS configuration allowing Vite frontend to connect seamlessly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Routers
app.include_router(projects_router, prefix="/api/projects", tags=["Projects"])
app.include_router(takeoff_router, prefix="/api/takeoff", tags=["Takeoff"])
app.include_router(exports_router, prefix="/api/exports", tags=["Exports"])
app.include_router(ai_router, prefix="/api/ai", tags=["AI Assistant"])
app.include_router(symbols_router, prefix="/api/symbols", tags=["Symbol Library"])
app.include_router(tenders_router, prefix="/api/tenders", tags=["Tender pipeline"])

# Mount cached images directory
app.mount("/cache", StaticFiles(directory=str(CACHE_DIR)), name="cache")

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "Jeffway AI Electrical Takeoff API",
        "version": "1.0.0",
        "endpoints": ["/api/projects/list", "/api/takeoff/auto-count", "/api/exports/excel", "/api/exports/pdf"]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
