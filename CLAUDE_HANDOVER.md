# Jeffway Electrical AI Takeoff System — Developer Handover & Technical Blueprint

> **Notice for Claude Code / Successor Engineers**:  
> This document is an exhaustive, production-grade technical handover detailing the architecture, computer vision algorithms, AI multi-modal pipeline, known hurdles, historical bugs/fixes, and future milestones for the **Jeffway AI Electrical Takeoff & Estimating Platform**.

---

## 1. Executive Summary & Problem Statement

### 1.1 The Business Context (Jeffway Report 4)
Jeff Way Electrical Services is a major UK electrical contracting group serving residential housebuilders (e.g., Curo, Persimmon, Vistry). In UK residential construction, electrical subcontractors receive a massive **Tender Pack** containing architectural blueprints, elevation drawings, mechanical & electrical (M&E) layouts, and specification schedules.

Historically, senior estimators at Jeff Way spend days manually clicking and counting every electrical symbol on large architectural floor plans (Page 24 Ground Floor, Page 25 First Floor, etc.) using generic takeoff software, then transposing those counts into a detailed pricing tender spreadsheet (**Report 4**).

### 1.2 The Technical Goal
Build a high-performance, human-in-the-loop AI Takeoff system capable of:
1. Ingesting multi-page vector/raster architectural blueprints (PDF).
2. Automatically isolating electrical drawing sheets from structural, elevation, and site layout pages.
3. Automatically identifying and masking the drawing's electrical legend / symbol schedule.
4. Performing **sub-5-second 1st-pass automated symbol counts** across full drawings ($>4000 \times 3000\text{ px}$) using optimized local computer vision (zero LLM token cost).
5. Performing an **AI 2nd-pass multi-modal verification** using GPT-4o Vision on ambiguous or low-confidence detections.
6. Grouping quantities into a room-by-room, fix-stage matrix (**1st Fix, 2nd Fix, Specialist**).
7. Exporting an audit-ready, formula-driven Excel takeoff schedule directly formatted for Jeff Way's estimating pipeline.

---

## 2. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Vite + React 18)                      │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ LeftSidebar           │  │ BlueprintCanvas │  │ RightSidebar     │  │
│  │ • Sheet Thumbnails    │  │ • Konva Pan/Zoom│  │ • BoQ Matrix     │  │
│  │ • Legend Presets      │  │ • Vector Markers│  │ • Fix Stages     │  │
│  │ • Template Crop Tool  │  │ • Exclusion Box │  │ • QC Audit Bar   │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│                             InstanceNavigator                          │
│                             • Jump to marker (prev/next)               │
│                             • Fast Approve (A) / Delete (Del)          │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ REST API (Port 8008)
┌────────────────────────────────────▼───────────────────────────────────┐
│                    BACKEND (FastAPI + Python 3.12/3.14)                │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Stage 1: Geometric Vision Engine (GeometricVisionMatcher)        │  │
│  │ • Multi-scale (0.9x-1.1x), Multi-angle (0°, 90°, 180°, 270°) NCC │  │
│  │ • Adaptive Template Auto-Tightening                              │  │
│  │ • Conditional Chroma Isolation (Red/Color vs Monochrome)         │  │
│  │ • Decoupled Composite Decomposition (Glyph vs Upright Text '2','3')│
│  │ • Distance-IoU (DIoU) Non-Maximum Suppression                    │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │ Low-confidence / Ambiguous       │
│  ┌──────────────────────────────────▼───────────────────────────────┐  │
│  │ Stage 2: AI Multi-Modal Second-Pass (OpenAIService)              │  │
│  │ • GPT-4o Vision Canonical Square Macro-Windows                   │  │
│  │ • Structured JSON Decision (status, confidence, reason)         │  │
│  │ • Persistent Audit Trail (audit_logs.json + UI Diagnostic Modal) │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Algorithms & Innovations

### 3.1 Conditional Chroma Isolation
* **The Problem**: On UK blueprints, electrical symbols (switches, sockets, spurs) are drawn in vibrant red or color, superimposed directly over thick black CAD structural walls, dashed wiring loops, and circuit annotation text (e.g., `12`, `13`). When computing standard grayscale cross-correlation (NCC), the heavy black wall lines dominate the math and drop correlation scores below detection thresholds ($0.31-0.34$).
* **The Naive Mistake**: Simply stripping all black pixels destroys detection for monochrome symbols (e.g., black smoke detectors, fans, extractors).
* **The Solution**: 
  1. Measure saturation ($S$) and value ($V$) of the cropped template. If $>15\%$ of strokes have $S > 35$ and $V > 35$, the template is classified as **chromatic**.
  2. If chromatic, the engine dynamically computes the dominant hue ($\text{Hue}_{\text{dom}}$) and generates an isolated single-channel chroma mask where matching red strokes are 255 and all black CAD lines, door swings, and circuit text become 0.
  3. If monochrome, pristine grayscale matching is retained, guaranteeing 100% generalizability.

### 3.2 Decoupled Rotation for Composite CAD Symbols
* **The Problem**: In architectural blueprints, the physical body/glyph of a wall switch (circle + diagonal tick) rotates with the angle of the wall ($0^\circ, 90^\circ, 180^\circ, 270^\circ$). However, architectural CAD software **always draws text and numeral modifiers (`2`, `3`, `USB`, `INT`) upright ($0^\circ$)** for drafting legibility. If you rotate a cropped 2-way switch template by $90^\circ$ or $180^\circ$, the numeral `2` turns sideways or upside down, causing template matching against the upright `2` on the blueprint to fail completely ($<0.48$).
* **The Solution** (Implemented in `backend/app/vision/template_matcher.py`):
  1. The composite template is decomposed using connected components into:
     - **Primary Glyph**: Largest connected stroke (circle + stem).
     - **Annotation Tag**: Upright numeral/text component (`2`, `3`, `USB`).
  2. The Primary Glyph is rotated across all angles ($0^\circ, 90^\circ, 180^\circ, 270^\circ$).
  3. When a glyph candidate is located, the engine searches the local bounding neighborhood specifically for the **upright ($0^\circ$) annotation tag**.
  4. The composite score is $0.50 \times \text{Glyph Score} + 0.50 \times \text{Tag Score}$.
  5. **Result**: Correlation score for doorway 2-way and 3-way switches immediately jumped from $0.48$ to **$>0.91$**!

### 3.3 Centroid-Ratio Distance IoU Non-Maximum Suppression (NMS)
* **The Problem**: Single switches on walls (`1 gang 1 way switch`) were previously double-counted because the circle head and the tick stem each triggered separate overlapping peaks.
* **The Solution**: Formulated a combined distance ratio + DIoU suppression threshold:
  $$\text{dist\_thresh} = \max(30.0, 1.35 \times \text{ref\_dimension})$$
  Suppressing candidate boxes whose centroids fall within the physical footprint of an already accepted peak eliminates double-counting while preserving legitimate side-by-side switches at doorways.

---

## 4. Key Roadblocks Encountered & Resolutions

| # | Roadblock | Root Cause | Exact Resolution |
| :--- | :--- | :--- | :--- |
| **1** | **UI showing 0 detected switches** | In `frontend/src/App.tsx`, `dedupedNew` deduplicated against *all* existing markers in `remaining` without checking `if (ex.legend_id !== targetLegend.legend_id)`. Any nearby socket, TV point, or previous switch killed new candidates. | Added `if (ex.legend_id !== targetLegend.legend_id) return false;` in `App.tsx` and updated `setLegends` count. |
| **2** | **Rotated 2-way & 3-way switch failure** | Rotating full crops rotated numerals `2` and `3` sideways, destroying NCC match against upright CAD blueprint text. | Decoupled rotation: rotate glyph with wall angles, match numeral upright at $0^\circ$. |
| **3** | **OpenAI API temperature error** | Modern reasoning models return 400 when passing `temperature: 0.0`. | Stripped `temperature` parameter from `OpenAIService` payloads. |
| **4** | **Audit logs lost across server restarts** | Audit logs were stored purely in an in-memory Python array. | Created `AuditLogger` with atomic JSON persistence to `backend/data/audit_logs.json`. |
| **5** | **Switch stem double-counting** | Overlap threshold alone failed because bounding boxes only partially overlapped between circle and diagonal tick. | Switched to centroid Euclidean distance with `center_dist_ratio = 1.35`. |
| **6** | **PyMuPDF memory paging error on Windows** | A background diagnostic process consumed 1GB RAM, triggering Windows pagefile limits. | Terminated orphaned PID and optimized image caching so PyMuPDF is only invoked when cache is cold. |

---

## 5. Repository File Guide

### 5.1 Backend (`backend/`)
- `app/main.py`: FastAPI server entrypoint (ports, CORS, static `/cache` mounting).
- `app/vision/template_matcher.py`: **The core vision algorithm** (Conditional Chroma Isolation, Decoupled Composite Decomposition, NMS, Multi-scale NCC).
- `app/services/pdf_service.py`: High-DPI rasterization (PyMuPDF `fitz`), automated legend table boundary detection, title block exclusion.
- `app/services/openai_service.py`: GPT-4o Vision 2nd-pass auditor, canonical square macro-window extraction, JSON decision schema.
- `app/services/audit_logger.py`: Disk-persisted audit trail (`backend/data/audit_logs.json`).
- `app/services/excel_service.py`: 3-tab audit-ready Excel export generation (`openpyxl`).
- `app/api/takeoff.py`: Endpoints for `/api/takeoff/auto-count`, `/api/takeoff/verify-candidates-ai`, `/api/takeoff/save-state`, `/api/takeoff/audit-logs`.
- `data/sample_blueprints/The Avebury.pdf`: Canonical benchmark PDF (~3.1 MB) for testing.
- `data/projects/proj_avebury_curo/state.json`: Master project state with verified legends, rooms, and markers.

### 5.2 Frontend (`frontend/`) — "Plotline" UI (rebuilt Nov 2026)
The design system, principles and product story live in `design/plotline-design-system.html`.
- `src/state/useTakeoff.ts`: **All app state and every backend call** (load project, auto-count with same-symbol dedupe, review approve/reject with undo, AI check, legend-zone detection, rooms, plots, exports, debounced auto-save to `/api/takeoff/save-state`). Components never call the API directly.
- `src/lib/api.ts`: Typed API client. Base URL from `VITE_API_BASE` (default `http://127.0.0.1:8008/api`).
- `src/lib/types.ts`, `src/lib/util.ts`: Shared types; counting rule (`isCounted`: approved, AI-checked, or above the confidence slider).
- `src/App.tsx`: Shell layout, collapsible/resizable panels, focus mode, theme (system/light/dark), keyboard shortcuts, command bar items.
- `src/components/CanvasView.tsx`: Konva canvas — wheel/pinch zoom, pan, marks, rooms, excluded areas, crop/exclude/room/place tools, Paper/Blueprint rendering.
- `src/components/Overlays.tsx`: Canvas toolbox, zoom + view controls, tool hints, progress bar, floating **review dock**.
- `src/components/LeftPanel.tsx`: Sheets / Symbols / Rooms & excluded areas.
- `src/components/Inspector.tsx`: Quantities (sheet / house / × plots), Plots & first-fix cable estimate (from `symbol_library.json` `cable_per_point_m`), AI log.
- `src/components/Modals.tsx`: New symbol (after crop), AI check, Settings, Symbol library editor, Room name, Shortcuts.
- `src/components/CommandPalette.tsx`: ⌘K / Ctrl+K command bar.
- `src/styles.css`: Design tokens (light + dark) and all component styles. No CSS framework.

Keyboard: A approve · X reject · J/K next/prev · ⇧J/⇧K next/prev sheet · V/M/C/E/R tools · ⇧C count selected symbol · [ ] panels · F focus · B blueprint · 0 fit · ⌘K command bar · ⌘S save · ? shortcuts.

---

## 5.3 One-click tender pipeline (Nov 2026)
`backend/app/services/pipeline_service.py` + `backend/app/api/tenders.py`, UI in `frontend/src/components/Tenders.tsx` and `ReviewQueue.tsx`.

1. **Upload** (`POST /api/tenders/upload`): folder (relative paths kept), zip, or loose PDFs → `backend/data/tenders/<id>/pack/`.
2. **Scan**: each PDF with ≥1 electrical page becomes a house type (one project in `data/projects/`); other files are listed as documents.
3. **First pass**: every library symbol with a sample image × every electrical sheet, 4 threads. Samples come from `symbol_library.json` `template_image_b64` via `template_bgr_override`, so they work on any PDF. Identical samples are matched once.
4. **Clean-up**: legend rows are removed by reading the CAD text (a mark with a symbol description printed just to its right is a legend entry; page rotation is applied). A detected legend area is only trusted if it contains a "Legend" heading and is narrower than half the sheet. Overlapping marks of different symbols keep the stronger one.
5. **Bands**: ≥ `auto_high` (0.85) strong, no AI · `ai_low`–`auto_high` (0.60–0.85) sent to AI (batches of 8, capped by `max_ai_marks`) · below `ai_low` kept but hidden by default · below `min_keep` (0.55) dropped. AI-kept marks take the AI's confidence; AI-rejected marks are deleted.
6. **Review**: `GET /api/tenders/<id>/marks`, decisions via `POST /api/tenders/<id>/decision` (approve / reject / restore for undo), crops via `GET /api/tenders/crop/image`.

7. **Accommodation schedule** (`services/schedule_service.py`): any xlsx/csv in the pack (names containing "accommodation"/"schedule" first) is scanned for a header row with a house-type column; one plot per row. Drawings match by normalised name; a drawing matching several variants sums them. Checked against Jeffway's filled Curo workbook: 208 plots, all named house types equal. Upload separately via `POST /api/tenders/<id>/schedule`.
8. **AI on demand**: `ai_mode` "manual" (default) skips AI in the run. `POST /ai-estimate` returns marks / calls / estimated cost; `POST /ai-run` runs it in the background and merges results into the saved state without overwriting review decisions made meanwhile. Marks AI has seen are never re-sent.
9. **Cost ledger** (`services/cost_ledger.py`, `data/ai_costs.json`): every OpenAI call records real token usage priced from `PRICES`; tagged per tender. `GET /api/tenders/costs/summary`. Estimates use the average of the last 50 real calls once 3+ exist (default $0.0175/call ≈ 4.2k in + 0.7k out on gpt-4o).

10. **Which sheets are electrical** (`services/sheet_classifier.py`, used by `PDFService.inspect_pdf` and the pipeline). The deciding test is a **printed legend block**: a heading (Legend / Key / Symbols) with ≥3 library symbol descriptions stacked under it in one column (or, without a heading, 5+ left-aligned description lines). Callout notes scattered over a plan ("Pendant light", "Smoke detector to be installed…") don't count. Verdicts: legend on a plan → **yes**; electrical/M&E title without a legend (e.g. Roof M&E Plan) → **maybe**; 3+ electrical mentions without a legend (WC/bathroom layouts, joist/roof plans) → **maybe**; cover registers, legend-only sheets, everything else → **no**. A second "yes" sheet with the same title (e.g. Kensington KENS/900-901 and 903-904, for different plot groups) is flagged **maybe** with both plot lists, since counting both double-counts. Titles come from the title block; text positions are normalised against the displayed (rotated) page size. Checked on Avebury, Holbourne M4(3), Bruton and Kensington: counted = kitchen layout + floor electrical plans in every case. Users confirm per PDF in the sheet picker (`POST /api/tenders/<id>/sheets`); picking sheets in a "document" PDF promotes it to a house type, clearing all demotes it.

11. **Live / incremental runs**: sheets are processed one at a time (symbols in parallel within a sheet) and each finished sheet is merged into the house type's `state.json` straight away (`_merge_sheet`: keeps approved / manual / AI-confirmed marks, replaces unreviewed ones on re-run). Only one sheet image is in memory at a time. The overview, review queue and AI check all work mid-run; the UI polls (`progress.sheets_done`, `sheet_state`, `ai_progress`). The AI check runs on its own thread (`<tid>#ai`) with its own `ai_progress`, never touching the counting status, and merges into the latest state. `POST /api/tenders/<id>/stop` stops after the current sheet.

12. **Modifier codes** (`services/modifiers.py`): variants of one glyph that differ only by a printed code (HL, USB, 2, 3, R, BA, CL ...). Each sheet's own legend is read as CAD text: rows are whole blocks, or individual lines when a block lists several items (1/2/3-way switches); each code goes to the nearest row to its right; each library symbol takes its best-worded row. On the plan, each code belongs to the nearest confident mark. A mark with another item's code is moved to that symbol if the library has it, otherwise marked down 0.3 (missing own code: 0.2) with `metadata.modifier_check`. The AI check gets the sheet's code list, whether the target carries a code, the code text beside each candidate (from the CAD file), wider crops, and a rule that codes are part of a symbol's identity (the old "ignore background" wording made it dismiss "HL"). Checked on Holbourne: HL oven outlet 0.76 -> 0.46; USB worktop socket moved to the USB symbol. Note: the HL flex outlet itself isn't in the library yet.

13. **CAD layer check** (`services/cad_layers.py`, free, runs in the pipeline after the modifier check). The PDFs keep the architect's CAD layers (`page.get_drawings()[i]["layer"]`), e.g. Curo: DOWNLIGHTER, CEILING FANS (pendants), FIRE DETECTION, CEILING MOUNTED EXTRACT, LIGHTING, SERVICES (sockets/switches/spurs, mixed), RADIATOR, TITLE SHEET. Nothing is hard-coded: per tender, strong matches (≥0.85) teach which layers each symbol sits on (identical-sample symbols share one group). Marks below 0.85 are judged by the layer most of their own strokes are on: on this symbol's own single-symbol layer → raised to auto_high (counted, no AI); on another symbol's layer → -0.2; on a non-electrical layer (name doesn't look electrical, no strong matches there) when the symbol's layer is known → -0.35; too little evidence (e.g. one consumer unit per house) → not judged. `possible_missed` finds symbol-sized stroke groups on single-symbol layers with no counted mark and adds them at 0.5 with status `possible_missed` (own review-queue view, never sent to AI, counted only when approved). Avebury 3 sheets vs Jeffway workbook: error 58 → 57, AI band (0.60–0.85) 121 → 62 marks; demoted marks were all false (downlights on RADIATOR, pendants on TITLE SHEET). PDFs without layers (< 5 named layers) skip it.

14. **All free checks, in order** (`services/sheet_checks.py` `TenderChecks.run`, called by the pipeline per sheet and by the accuracy harness, so what is measured is what runs): code letters → CAD layer → **stroke pattern** (`services/shapes.py`: every copy of a CAD block has the same strokes; patterns are learned from each sheet's own legend glyph and from strong matches; a weak mark with its symbol's pattern is confirmed, with another symbol's only pattern is moved, uncovered copies are added; stroke groups are used so walls/door lines in the box don't matter, with an inside-the-box fallback for a symbol touching a dimension line) → **lettered symbols** (S / HD / P / B text inside a drawn circle, letters read from the legend glyphs) → same-spot duplicates → **switch plates** (two switch glyphs touching = one 2-gang plate; Curo draws no 2-gang symbol) → **rooms** (`services/rooms.py`: walls/doors/windows/plaster layers drawn, door swings closed via their radii, areas named by room labels; rule file `data/room_rules.json` or the default "IP downlights in wet rooms"). After a house type's last sheet, `finish_house` marks down detail-sheet repeats (a kitchen layout's ceiling lights that the floor plan already counts; items only on the detail sheet, like the cooker control unit, stay). Roof/loft M&E plans are now counted by default (sheet_classifier: electrical title + "plan"). Library: plain switches priced on row 49 (row 48 is empty on all 26 Jeffway tabs); HL high-level flex outlet added (row 19, same sample as the single socket, moved there by its "HL" code). Then **printed codes confirm** weak marks (a mark with exactly its own legend code beside it, e.g. BA / CL / R, is that item).

15. **Pricing rules** (`services/pricing_rules.py`, editable in `data/pricing_rules.json`, used by the workbook export and the accuracy tool): fans and blanking plates not priced on houses; the "fused spur to extract fans and cylinder" symbol split by what it feeds (airing cupboard → row 33, loft → row 34, first fan spur → row 30, more → row 32); media plate adds 2 twin sockets; coax at the media plate / Sky entry isn't a TV point; oven/hob/HL flex outlets → row 19; one heat pump board, cooker control unit and cooker outlet per house; a standard per-house kit (RCBOs, grid switches, junction boxes …) ready but switched off. Each rule-made quantity is listed with its reason on the export's "Plotline takeoff" sheet. The rules and their evidence are in the doc "Plotline counting & pricing rules — for Jeffway to confirm".

   Accuracy vs Jeffway's workbook (rows our library maps to, counted = score ≥ 0.80, no AI, no review): see the accuracy report in the session notes. Harness: `/tmp`-style scripts are not in the repo; the method is `TenderChecks.run` per sheet + `finish_house`, then sum per workbook row and compare with the house tab's column A.

Timing: ~1.4 s per symbol per sheet at 3 scales on 4 cores (~2 min for a 5-sheet house type); `quick` uses one scale (~3× faster).
Demo walkthrough: `DEMO_SCRIPT.md`.

## 6. Tender Pack Data & Cloud Drive Strategy

The full Curo tender pack (`Curo Tender Docs for AI`) is approximately **688 MB** and contains dozens of PDFs for site 1664516 (Bath Road, Keynsham).
- **In Git**: We have included `backend/data/sample_blueprints/The Avebury.pdf` (~3.1 MB), which contains the complete Ground Floor (Page 24) and First Floor (Page 25) electrical plans used for all benchmarks.
- **For Claude Code Web**:
  1. Upload the `Curo Tender Docs for AI` folder to **Google Drive** or **OneDrive/Dropbox**.
  2. Generate a public/viewable shared link.
  3. Claude Code Web or remote runners can curl/wget or mount the drive directory if evaluating house types beyond *The Avebury*.
  4. The estimating pricing sheets are committed in `Report 4 Excel Sheets/`.

---

## 7. How to Run Locally

### Backend
```powershell
# In workspace root
python -m uvicorn app.main:app --app-dir backend --port 8008 --host 127.0.0.1
```
*Health check*: `GET http://127.0.0.1:8008/`

### Frontend
```powershell
# In frontend directory
cd frontend
npm install
npm run dev -- --port 5174
```
*Web App URL*: `http://localhost:5174/`

---

## 8. Immediate Next Steps for Next Developer
1. **Multi-Page Batch Execution**: Currently, Auto-Count runs per active page. Add a "Run Entire Drawing Set" action that loops over all electrical sheets (`is_electrical: true`).
2. **Room Boundary Snapping**: The current room zones are polygonal. Integrate automatic vector room label detection so markers auto-assign to "Kitchen", "Lounge", "Bed 1", etc.
3. **Claude Code / LLM Integration**: Connect the backend `/verify-candidates-ai` endpoint to Claude 3.5 Sonnet Vision or GPT-4o via user-configured API key in `.env`.
