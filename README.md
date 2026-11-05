# Jeffway AI Electrical Takeoff & Estimating System

> **Automated architectural blueprint electrical takeoff, symbol counting, and tender schedule estimation platform for UK residential contractors.**

---

## Overview

The Jeffway AI Electrical Takeoff system accelerates electrical subcontract estimating from hours/days down to minutes. It ingests multi-page architectural blueprints (PDF), isolates electrical plans, automatically excludes legend tables and title blocks, and executes a high-speed 2-pass vision takeoff:

1. **Pass 1 — Geometric Vision Engine**: Multi-scale, multi-angle normalized cross-correlation (NCC) with **Conditional Chroma Isolation** and **Decoupled Composite Decomposition** (running locally in $<5$s with zero LLM API cost).
2. **Pass 2 — AI Multi-Modal Verification**: GPT-4o Vision audits ambiguous or low-confidence detections using canonical macro-windows and persists a detailed decision log.
3. **Bill of Quantities (BoQ) Matrix**: Real-time breakdown by room and fix stage (**1st Fix, 2nd Fix, Specialist**).
4. **Excel Export**: Produces formatted, audit-ready Excel schedules aligned with Jeffway's estimating tender packs.

For complete technical documentation, algorithmic details, and architecture diagrams, see [CLAUDE_HANDOVER.md](CLAUDE_HANDOVER.md).

---

## Quick Start

### 1. Prerequisites
- **Python**: 3.10+ (tested on Python 3.12 / 3.14)
- **Node.js**: 18+ (tested with Vite 8 / React 18)

### 2. Environment Setup
Copy the environment template and configure your OpenAI API key (optional, used for Stage 2 AI verification):
```bash
cp .env.example .env
```
Edit `.env`:
```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=8008
HOST=127.0.0.1
```

### 3. Backend Setup
```bash
# Install Python dependencies
pip install -r backend/requirements.txt

# Start backend server
python -m uvicorn app.main:app --app-dir backend --port 8008 --host 127.0.0.1
```
*API docs available at: `http://127.0.0.1:8008/docs`*

### 4. Frontend Setup
```bash
cd frontend
npm install
npm run dev -- --port 5174
```
*Application available at: `http://localhost:5174/`*

---

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── api/             # FastAPI REST endpoints (takeoff, projects, exports)
│   │   ├── core/            # Config, paths, environment
│   │   ├── services/        # PDF rasterization, Excel generation, OpenAI Vision, Audit Logging
│   │   └── vision/          # Template matching & geometric vision algorithms
│   ├── data/
│   │   ├── cache/           # Rendered page cache & template presets
│   │   ├── projects/        # Project annotations, rooms, and state.json
│   │   └── sample_blueprints/ # The Avebury benchmark PDF
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/      # Konva Canvas, Navigator, Sidebars, Modals
│   │   ├── services/        # API client
│   │   └── types/           # Takeoff TypeScript schemas
│   ├── package.json
│   └── vite.config.ts
├── Report 4 Excel Sheets/   # Jeffway tender pricing reference workbooks
├── CLAUDE_HANDOVER.md       # Comprehensive developer & LLM handover guide
└── .env.example
```

---

## Documentation
- [CLAUDE_HANDOVER.md](CLAUDE_HANDOVER.md): Algorithmic deep-dive, historical bug solutions, and development roadmap.
- `Jeffway_AI_Automation_Opportunity_Report_4_V2 (1) (1).docx.pdf`: Original opportunity assessment and specification.
