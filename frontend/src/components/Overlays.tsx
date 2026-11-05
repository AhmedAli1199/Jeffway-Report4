import {
  Check, ChevronLeft, ChevronRight, CircleCheck, Crop, Hand, LoaderCircle, Maximize, Minus, MousePointerClick,
  Plus, Sparkles, SquareDashed, Scan, X, Map as MapIcon, FileText,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { Takeoff } from "../state/useTakeoff";
import type { CanvasMode, ReviewFilter, Tool } from "../lib/types";
import { cx, isApproved } from "../lib/util";
import { SymbolSample } from "./ui";
import type { CanvasControls } from "./CanvasView";

const TOOLS: { id: Tool; label: string; key: string; icon: typeof Hand }[] = [
  { id: "select", label: "Select & pan", key: "V", icon: Hand },
  { id: "add", label: "Place a mark", key: "M", icon: MousePointerClick },
  { id: "crop", label: "Crop a symbol sample", key: "C", icon: Crop },
  { id: "exclude", label: "Exclude an area from counts", key: "E", icon: SquareDashed },
  { id: "room", label: "Draw a room", key: "R", icon: Scan },
];

export function Toolbox({ t }: { t: Takeoff }) {
  return (
    <div className="float toolbox" role="toolbar" aria-label="Canvas tools">
      {TOOLS.map((x, i) => (
        <div key={x.id} style={{ display: "contents" }}>
          {i === 2 && <hr />}
          <button
            className={cx("icon-btn", t.tool === x.id && "on")}
            title={`${x.label}  (${x.key})`}
            aria-label={x.label}
            aria-pressed={t.tool === x.id}
            onClick={() => (x.id === "crop" ? t.startCrop(null) : t.setTool(x.id))}
          >
            <x.icon size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ZoomBox({ controls, scale }: { controls: RefObject<CanvasControls | null>; scale: number }) {
  return (
    <div className="zoombox">
      <button className="icon-btn" aria-label="Zoom out" title="Zoom out  (−)" onClick={() => controls.current?.zoomBy(1 / 1.25)}>
        <Minus size={15} />
      </button>
      <button className="pct" title="Zoom to 100%" onClick={() => controls.current?.zoomTo(1)}>
        {Math.round(scale * 100)}%
      </button>
      <button className="icon-btn" aria-label="Zoom in" title="Zoom in  (+)" onClick={() => controls.current?.zoomBy(1.25)}>
        <Plus size={15} />
      </button>
      <button className="icon-btn" aria-label="Fit sheet" title="Fit sheet  (0)" onClick={() => controls.current?.fit()}>
        <Maximize size={15} />
      </button>
    </div>
  );
}

export function ViewBox({ mode, setMode, children }: { mode: CanvasMode; setMode: (m: CanvasMode) => void; children?: ReactNode }) {
  return (
    <div className="float viewbox">
      {children}
      <span className="vsep" />
      <div className="seg" role="group" aria-label="Sheet appearance">
        <button aria-pressed={mode === "paper"} onClick={() => setMode("paper")} title="White paper">
          <FileText size={13} /> Paper
        </button>
        <button aria-pressed={mode === "blueprint"} onClick={() => setMode("blueprint")} title="Blueprint, easier on the eyes for long sessions  (B)">
          <MapIcon size={13} /> Blueprint
        </button>
      </div>
    </div>
  );
}

const HINTS: Partial<Record<Tool, string>> = {
  add: "Click the drawing to place a mark",
  crop: "Drag a tight box around one example of the symbol",
  exclude: "Drag a box over an area that shouldn't be counted",
  room: "Drag a box around a room",
};

export function ToolHint({ t }: { t: Takeoff }) {
  const hint = HINTS[t.tool];
  if (!hint) return null;
  const extra =
    t.tool === "add" && t.selectedLegend
      ? ` for ${t.selectedLegend.label}`
      : t.tool === "crop" && t.cropTarget
        ? ` for ${t.cropTarget.label}`
        : "";
  return (
    <div className="tool-hint">
      {hint}
      {extra}
      <button className="btn btn-sm" onClick={() => { t.setTool("select"); t.setCropTarget(null); }}>
        Done <span className="kbd" style={{ background: "transparent", color: "inherit", boxShadow: "none" }}>Esc</span>
      </button>
    </div>
  );
}

export function BusyBar({ t }: { t: Takeoff }) {
  const b = t.busy;
  if (b.batch) {
    return (
      <div className="busy-bar">
        <LoaderCircle size={15} className="spin" />
        Counting {b.counting ?? "symbols"}
        <span className="progress"><i style={{ width: `${(b.batch.done / b.batch.total) * 100}%` }} /></span>
        <span className="mono muted">{b.batch.done + 1}/{b.batch.total}</span>
      </div>
    );
  }
  if (b.counting) {
    return (
      <div className="busy-bar">
        <LoaderCircle size={15} className="spin" /> Counting {b.counting}…
      </div>
    );
  }
  return null;
}

const FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: "open", label: "To review" },
  { id: "ai", label: "AI-checked" },
  { id: "approved", label: "Approved" },
  { id: "all", label: "All" },
];

export function ReviewDock({ t, onAICheck }: { t: Takeoff; onAICheck: () => void }) {
  if (t.tool !== "select" || t.busy.batch) return null;
  const list = t.reviewList;
  const m = t.selectedMarker && list.some((x) => x.marker_id === t.selectedMarkerId) ? t.selectedMarker : null;
  const idx = m ? list.findIndex((x) => x.marker_id === m.marker_id) : -1;
  const legend = m ? t.legends.find((l) => l.legend_id === m.legend_id) ?? null : t.selectedLegend;

  if (t.visibleMarkers.length === 0) return null;

  const status = m
    ? isApproved(m)
      ? <span className="pill pill-ok">Approved</span>
      : m.status === "ai_verified"
        ? <span className="pill pill-ai">AI-checked</span>
        : <span className="pill pill-review">To review</span>
    : null;

  return (
    <div className="dock" role="toolbar" aria-label="Review marks">
      <div className="seg" role="group" aria-label="Which marks">
        {FILTERS.map((f) => (
          <button key={f.id} aria-pressed={t.filter === f.id} onClick={() => t.setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <span className="sep" />
      {list.length === 0 ? (
        <div className="dock-done">
          <CircleCheck size={16} />
          {t.filter === "open" ? (
            <span>
              Nothing left to review{t.selectedLegend ? ` for ${t.selectedLegend.label}` : " on this sheet"}.
            </span>
          ) : (
            <span>No marks in this view.</span>
          )}
          {t.selectedLegend && (
            <button className="btn btn-ghost btn-sm" onClick={() => t.setSelectedLegendId(null)}>
              Show all symbols
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="who">
            <SymbolSample legend={legend} size={34} />
            <div style={{ minWidth: 0 }}>
              <div className="name truncate">{legend?.label ?? "All symbols"}</div>
              <div className="sub">
                <span className="mono">{idx >= 0 ? idx + 1 : "–"} of {list.length}</span>
                {m && <span className="mono">{Math.round(m.confidence_score * 100)}%</span>}
                {m && m.room && m.room !== "Unassigned" && <span>{m.room}</span>}
                {status}
              </div>
            </div>
          </div>
          <span className="sep" />
          <button className="icon-btn" aria-label="Previous" title="Previous  (K or ←)" onClick={() => t.step(-1)}>
            <ChevronLeft size={17} />
          </button>
          <button className="icon-btn" aria-label="Next" title="Next  (J or →)" onClick={() => t.step(1)}>
            <ChevronRight size={17} />
          </button>
          {m ? (
            <>
              <button className="btn btn-danger" onClick={() => t.reject()} title="Not this symbol: remove the mark">
                <X size={14} /> Reject <span className="kbd">X</span>
              </button>
              {!isApproved(m) && (
                <button className="btn btn-ok" onClick={() => t.approve()}>
                  <Check size={14} /> Approve <span className="kbd">A</span>
                </button>
              )}
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => t.step(1)}>
              Start review <span className="kbd">J</span>
            </button>
          )}
          {t.filter === "open" && (
            <button className="icon-btn" title="Ask AI to check these marks" aria-label="AI check" onClick={onAICheck}>
              <Sparkles size={16} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
