import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Expand, LoaderCircle, Minus, Plus, Scan, TriangleAlert, X } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import type { SheetInfo, Tender } from "../lib/types";
import { baseName, cx, store } from "../lib/util";
import { Modal } from "./ui";

const VERDICT = {
  yes: { label: "Electrical", cls: "pill-ok" },
  maybe: { label: "Check", cls: "pill-review" },
  no: { label: "Not electrical", cls: "pill-plain" },
} as const;

type Size = "s" | "m" | "l";
const SIZES: Record<Size, { min: number; img: number; label: string }> = {
  s: { min: 240, img: 560, label: "Small" },
  m: { min: 360, img: 820, label: "Medium" },
  l: { min: 520, img: 1200, label: "Large" },
};

/** Review which pages of one PDF get counted. */
export function SheetPicker({
  tenderId, relPath, filepath, sheets, selected, onClose, onSaved,
}: {
  tenderId: string;
  relPath: string;
  filepath: string;
  sheets: SheetInfo[];
  selected: number[];
  onClose: () => void;
  onSaved: (t: Tender) => void;
}) {
  const toast = useToast();
  const [pick, setPick] = useState<Set<number>>(new Set(selected));
  const [view, setView] = useState<"suggested" | "all">(sheets.some((s) => s.verdict !== "no") ? "suggested" : "all");
  const [size, setSizeState] = useState<Size>(() => store.get("pl.sheetSize", "m"));
  const [preview, setPreview] = useState<number | null>(null); // index into `shown`
  const [saving, setSaving] = useState(false);
  const setSize = (s: Size) => {
    setSizeState(s);
    store.set("pl.sheetSize", s);
  };

  const shown = useMemo(
    () => (view === "all" ? sheets : sheets.filter((s) => s.verdict !== "no" || pick.has(s.page_index))),
    [sheets, view, pick],
  );
  const counts = {
    yes: sheets.filter((s) => s.verdict === "yes").length,
    maybe: sheets.filter((s) => s.verdict === "maybe").length,
  };
  const toggle = useCallback(
    (i: number) =>
      setPick((p) => {
        const n = new Set(p);
        if (n.has(i)) n.delete(i);
        else n.add(i);
        return n;
      }),
    [],
  );

  const save = async () => {
    setSaving(true);
    try {
      const t = await api.setSheets(tenderId, relPath, [...pick]);
      onSaved(t);
      toast({
        tone: "success",
        title: pick.size ? `${pick.size} sheet${pick.size === 1 ? "" : "s"} will be counted` : "Removed from house types",
        body: baseName(relPath),
      });
      onClose();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const imgW = Math.round(SIZES[size].img * (dpr > 1 ? 1.4 : 1));

  return (
    <Modal
      wide
      className="sheet-modal"
      title={baseName(relPath).replace(/\.pdf$/i, "")}
      subtitle={`${sheets.length} page${sheets.length === 1 ? "" : "s"} · ${counts.yes} look electrical · ${counts.maybe} to check. Only ticked sheets are counted.`}
      onClose={() => (preview !== null ? setPreview(null) : onClose())}
      footer={
        <>
          <span className="muted grow">
            {pick.size} sheet{pick.size === 1 ? "" : "s"} selected
            {pick.size === 0 && " · saving with none moves this PDF to other documents"}
          </span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving && <LoaderCircle size={14} className="spin" />} Save sheet choice
          </button>
        </>
      }
    >
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <div className="seg" role="group" aria-label="Which pages">
            <button aria-pressed={view === "suggested"} onClick={() => setView("suggested")}>
              Likely electrical <span className="n">{counts.yes + counts.maybe}</span>
            </button>
            <button aria-pressed={view === "all"} onClick={() => setView("all")}>
              All pages <span className="n">{sheets.length}</span>
            </button>
          </div>
          <div className="seg" role="group" aria-label="Preview size">
            {(Object.keys(SIZES) as Size[]).map((k) => (
              <button key={k} aria-pressed={size === k} onClick={() => setSize(k)}>{SIZES[k].label}</button>
            ))}
          </div>
        </div>
        <div className="row">
          <button className="btn btn-quiet btn-sm" onClick={() => setPick(new Set(sheets.filter((s) => s.verdict === "yes").map((s) => s.page_index)))}>
            Reset to suggestion
          </button>
          <button className="btn btn-quiet btn-sm" onClick={() => setPick(new Set())}>Clear all</button>
        </div>
      </div>
      {counts.maybe > 0 && (
        <div className="callout">
          <TriangleAlert size={14} style={{ color: "var(--review)" }} />
          <span>
            Sheets marked <b>Check</b> mention a few electrical items but don't carry the legend, such as bathroom or WC
            layouts drawn at a larger scale. They're left out by default because counting them as well as the floor plan
            would double-count.
          </span>
        </div>
      )}
      <div className="sheet-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${SIZES[size].min}px, 100%), 1fr))` }}>
        {shown.map((s, idx) => {
          const on = pick.has(s.page_index);
          const v = VERDICT[s.verdict];
          return (
            <div key={s.page_index} className={cx("sheet-card", on && "on", s.verdict)}>
              <div className="sheet-thumb">
                <img
                  loading="lazy"
                  src={api.pagePreviewUrl(filepath, s.page_index, imgW)}
                  alt={s.title || `Page ${s.page_number}`}
                  onClick={() => setPreview(idx)}
                  title="Open full size"
                />
                <button className={cx("sheet-check", on && "on")} onClick={() => toggle(s.page_index)} aria-pressed={on}
                  aria-label={on ? "Leave this sheet out" : "Count this sheet"} title={on ? "Leave out" : "Count this sheet"}>
                  {on ? <Check size={15} /> : null}
                </button>
                <button className="sheet-expand" onClick={() => setPreview(idx)} aria-label="Open full size" title="Open full size">
                  <Expand size={14} />
                </button>
              </div>
              <div className="sheet-info">
                <b className="sheet-title" title={s.title}>{s.title || `Page ${s.page_number}`}</b>
                <div className="row" style={{ gap: 6 }}>
                  <span className={cx("pill", v.cls)}>{v.label}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>p.{s.page_number}</span>
                  <span className="grow" />
                  <button className={cx("btn btn-sm", on ? "btn-ghost" : "btn-ok")} onClick={() => toggle(s.page_index)}>
                    {on ? "Leave out" : "Count"}
                  </button>
                </div>
                <ul className="reasons">
                  {s.reasons.slice(1).map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
      {preview !== null && shown[preview] && (
        <Viewer
          sheet={shown[preview]}
          filepath={filepath}
          on={pick.has(shown[preview].page_index)}
          index={preview}
          total={shown.length}
          onToggle={() => toggle(shown[preview].page_index)}
          onNav={(d) => setPreview((p) => (p === null ? p : Math.min(shown.length - 1, Math.max(0, p + d))))}
          onClose={() => setPreview(null)}
        />
      )}
    </Modal>
  );
}

/* Full-screen sheet viewer: fit to screen, zoom, drag to pan, arrows to move, space to tick. */
function Viewer({
  sheet, filepath, on, index, total, onToggle, onNav, onClose,
}: {
  sheet: SheetInfo;
  filepath: string;
  on: boolean;
  index: number;
  total: number;
  onToggle: () => void;
  onNav: (d: 1 | -1) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1); // 1 = fit to screen
  const [loaded, setLoaded] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const v = VERDICT[sheet.verdict];

  useEffect(() => {
    setZoom(1);
    setLoaded(false);
  }, [sheet.page_index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); onNav(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onNav(-1); }
      else if (e.key === " ") { e.preventDefault(); onToggle(); }
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z * 1.4));
      else if (e.key === "-") setZoom((z) => Math.max(1, z / 1.4));
      else if (e.key === "0") setZoom(1);
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onNav, onToggle, onClose]);

  // Zoom around the click point
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = box.current;
    if (!el) return setZoom((z) => Math.min(6, Math.max(1, z * factor)));
    const r = el.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left + el.scrollLeft;
    const py = (cy ?? r.top + r.height / 2) - r.top + el.scrollTop;
    setZoom((z) => {
      const nz = Math.min(6, Math.max(1, z * factor));
      const k = nz / z;
      requestAnimationFrame(() => {
        el.scrollLeft = px * k - ((cx ?? r.left + r.width / 2) - r.left);
        el.scrollTop = py * k - ((cy ?? r.top + r.height / 2) - r.top);
      });
      return nz;
    });
  };

  return (
    <div className="viewer" role="dialog" aria-label="Sheet preview">
      <div className="viewer-bar">
        <div className="row" style={{ minWidth: 0 }}>
          <b className="truncate">{sheet.title || `Page ${sheet.page_number}`}</b>
          <span className={cx("pill", v.cls)}>{v.label}</span>
          <span className="mono muted">p.{sheet.page_number} · {index + 1} of {total}</span>
        </div>
        <div className="row">
          <button className="icon-btn" aria-label="Previous sheet" title="Previous (←)" disabled={index === 0} onClick={() => onNav(-1)}><ChevronLeft size={17} /></button>
          <button className="icon-btn" aria-label="Next sheet" title="Next (→)" disabled={index === total - 1} onClick={() => onNav(1)}><ChevronRight size={17} /></button>
          <span className="vsep" />
          <button className="icon-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomAt(1 / 1.4)}><Minus size={16} /></button>
          <span className="mono muted" style={{ minWidth: 48, textAlign: "center" }}>{zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
          <button className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomAt(1.4)}><Plus size={16} /></button>
          <button className="icon-btn" aria-label="Fit to screen" title="Fit (0)" onClick={() => setZoom(1)}><Scan size={16} /></button>
          <span className="vsep" />
          <button className={cx("btn", on ? "btn-ghost" : "btn-ok")} onClick={onToggle}>
            {on ? <><X size={14} /> Leave out</> : <><Check size={14} /> Count this sheet</>} <span className="kbd">Space</span>
          </button>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={18} /></button>
        </div>
      </div>
      <div
        ref={box}
        className={cx("viewer-stage", zoom > 1 && "zoomed")}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
          }
        }}
        onMouseDown={(e) => {
          const el = box.current;
          if (!el || zoom === 1) return;
          drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
        }}
        onMouseMove={(e) => {
          const el = box.current;
          if (!el || !drag.current) return;
          el.scrollLeft = drag.current.l - (e.clientX - drag.current.x);
          el.scrollTop = drag.current.t - (e.clientY - drag.current.y);
        }}
        onMouseUp={(e) => {
          const d = drag.current;
          drag.current = null;
          // A click (not a drag) toggles between fit and 2.5x at that point
          if (!d || (Math.abs(e.clientX - d.x) < 4 && Math.abs(e.clientY - d.y) < 4)) {
            if (zoom === 1) zoomAt(2.5, e.clientX, e.clientY);
            else if (d) setZoom(1);
          }
        }}
        onMouseLeave={() => (drag.current = null)}
      >
        {!loaded && <div className="viewer-loading"><LoaderCircle size={20} className="spin" /> Rendering sheet…</div>}
        <img
          key={sheet.page_index}
          src={api.pagePreviewUrl(filepath, sheet.page_index, 3000)}
          alt={sheet.title}
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={zoom === 1 ? { maxWidth: "100%", maxHeight: "100%" } : { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }}
        />
      </div>
      <div className="viewer-foot muted">
        Click to zoom in at a point, drag to move around, click again to fit. Ctrl + scroll also zooms. ← → for the next sheet, Space to count or leave out.
      </div>
    </div>
  );
}
