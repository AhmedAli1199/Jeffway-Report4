import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Crop, Download, FileSpreadsheet, FileText, Focus, Keyboard, Layers, LoaderCircle, Monitor, Moon,
  PanelLeft, PanelRight, RefreshCw, ScanLine, Settings, Shapes, Sparkles, Sun, Upload, Map as MapIcon,
} from "lucide-react";
import { useTakeoff } from "./state/useTakeoff";
import { API_BASE } from "./lib/api";
import type { CanvasMode, ThemePref } from "./lib/types";
import { cx, sheetTitle, store } from "./lib/util";
import { AppBar, type Stage } from "./components/AppBar";
import { LeftPanel, type LeftTab } from "./components/LeftPanel";
import { Inspector, type RightTab } from "./components/Inspector";
import { CanvasView, type CanvasControls } from "./components/CanvasView";
import { BusyBar, ReviewDock, ToolHint, Toolbox, ViewBox, ZoomBox } from "./components/Overlays";
import { AICheckModal, LibraryModal, RoomModal, SettingsModal, ShortcutsModal, SymbolModal } from "./components/Modals";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette";
import { SymbolSample } from "./components/ui";
import { HomeView, TenderView } from "./components/Tenders";
import { ReviewQueue } from "./components/ReviewQueue";

type View =
  | { name: "home" }
  | { name: "tender"; id: string }
  | { name: "review"; id: string; project_id?: string; legend_id?: string }
  | { name: "workspace"; tender?: string };

function readHash(): View {
  const [kind, id, a, b] = location.hash.replace(/^#/, "").split("-");
  if (kind === "tender" && id) return { name: "tender", id };
  if (kind === "review" && id) return { name: "review", id, project_id: a || undefined, legend_id: b || undefined };
  if (kind === "workspace") return { name: "workspace", tender: id || undefined };
  return { name: "home" };
}
function writeHash(v: View) {
  const h =
    v.name === "tender" ? `tender-${v.id}`
    : v.name === "review" ? `review-${v.id}-${v.project_id ?? ""}-${v.legend_id ?? ""}`.replace(/-+$/, "")
    : v.name === "workspace" ? `workspace${v.tender ? `-${v.tender}` : ""}`
    : "";
  if (location.hash.replace(/^#/, "") !== h) history.pushState(null, "", h ? `#${h}` : location.pathname);
}

type LeftMode = "open" | "rail" | "hidden";
type Dialog = null | "settings" | "library" | "shortcuts" | "ai" | "palette";

function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => store.get("pl.theme", "system"));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", pref);
    store.set("pl.theme", pref);
  }, [pref]);
  const resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  return { pref, setPref, resolved };
}

export default function App() {
  const t = useTakeoff();
  const theme = useTheme();
  const [view, setViewState] = useState<View>(readHash);
  const go = useCallback((v: View) => {
    writeHash(v);
    setViewState(v);
  }, []);
  useEffect(() => {
    const on = () => setViewState(readHash());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const openDrawing = async (
    ht: { project_id: string; name: string; filepath: string; filename?: string },
    tenderId: string,
    page?: number,
    markerId?: string,
  ) => {
    go({ name: "workspace", tender: tenderId });
    await t.openProject({ project_id: ht.project_id, name: ht.name, filepath: ht.filepath, filename: ht.filename ?? "" }, { page, markerId });
  };
  const leaveWorkspace = async (v: View) => {
    if (t.save === "dirty") await t.saveNow();
    go(v);
  };

  const [leftMode, setLeftMode] = useState<LeftMode>(() => store.get("pl.leftMode", "open"));
  const [rightOpen, setRightOpen] = useState<boolean>(() => store.get("pl.rightOpen", true));
  const [leftW, setLeftW] = useState<number>(() => store.get("pl.leftW", 272));
  const [rightW, setRightW] = useState<number>(() => store.get("pl.rightW", 320));
  const [leftTab, setLeftTab] = useState<LeftTab>("symbols");
  const [rightTab, setRightTab] = useState<RightTab>("quantities");
  const [focusMem, setFocusMem] = useState<{ left: LeftMode; right: boolean } | null>(null);
  const [resizing, setResizing] = useState<null | "left" | "right">(null);
  const [mode, setModeState] = useState<CanvasMode>(() => store.get("pl.canvasMode", "paper"));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [scale, setScale] = useState(0.3);
  const controls = useRef<CanvasControls | null>(null);

  useEffect(() => store.set("pl.leftMode", leftMode), [leftMode]);
  useEffect(() => store.set("pl.rightOpen", rightOpen), [rightOpen]);
  useEffect(() => store.set("pl.leftW", leftW), [leftW]);
  useEffect(() => store.set("pl.rightW", rightW), [rightW]);
  const setMode = (m: CanvasMode) => {
    setModeState(m);
    store.set("pl.canvasMode", m);
  };

  const cycleLeft = () => {
    setFocusMem(null);
    setLeftMode((m) => (m === "open" ? "rail" : m === "rail" ? "hidden" : "open"));
  };
  const toggleRight = () => {
    setFocusMem(null);
    setRightOpen((o) => !o);
  };
  const toggleFocus = () => {
    if (focusMem) {
      setLeftMode(focusMem.left);
      setRightOpen(focusMem.right);
      setFocusMem(null);
    } else {
      setFocusMem({ left: leftMode, right: rightOpen });
      setLeftMode("hidden");
      setRightOpen(false);
    }
  };
  const showLeft = (tab: LeftTab) => {
    setLeftTab(tab);
    setLeftMode("open");
    setFocusMem(null);
  };
  const showRight = (tab: RightTab) => {
    setRightTab(tab);
    setRightOpen(true);
    setFocusMem(null);
  };

  // Panel resizing
  useEffect(() => {
    if (!resizing) return;
    const move = (e: MouseEvent) => {
      if (resizing === "left") setLeftW(Math.max(220, Math.min(420, e.clientX)));
      else setRightW(Math.max(260, Math.min(480, window.innerWidth - e.clientX)));
    };
    const up = () => setResizing(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [resizing]);

  const elecPages = useMemo(() => t.project?.pages.filter((p) => p.is_electrical) ?? [], [t.project]);
  const stepSheet = useCallback(
    (dir: 1 | -1) => {
      const pages = elecPages.length ? elecPages : t.project?.pages ?? [];
      if (!pages.length) return;
      const i = pages.findIndex((p) => p.page_index === t.pageIndex);
      const n = pages[(i + dir + pages.length) % pages.length];
      t.goToPage(n.page_index);
    },
    [elecPages, t],
  );

  const onStage = (s: Stage) => {
    if (s === "pack") showLeft("sheets");
    else if (s === "legend") showLeft("symbols");
    else if (s === "count") {
      showLeft("symbols");
      t.countAllOnSheet();
    } else if (s === "review") {
      t.setFilter("open");
      t.step(1);
    } else if (s === "plots") showRight("plots");
    else setExportOpen(true);
  };

  // Keyboard
  const modalOpen = dialog !== null || t.cropIntent !== null || t.pendingRoom !== null;
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (view.name !== "workspace") return;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setDialog((d) => (d === "palette" ? null : "palette"));
      return;
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      t.saveNow();
      return;
    }
    const el = e.target as HTMLElement;
    if (view.name !== "workspace") return;
    if (modalOpen || el.closest("input, textarea, select, [contenteditable]") || mod || e.altKey) return;

    const k = e.key;
    const handled = () => e.preventDefault();
    if (k === "Escape") {
      if (t.tool !== "select") {
        t.setTool("select");
        t.setCropTarget(null);
      } else t.selectMarker(null);
    } else if (k === "a" || k === "A") { t.approve(); handled(); }
    else if (k === "x" || k === "Delete" || k === "Backspace") { t.reject(); handled(); }
    else if (k === "J" && e.shiftKey) { stepSheet(1); handled(); }
    else if (k === "K" && e.shiftKey) { stepSheet(-1); handled(); }
    else if (k === "j" || k === "ArrowRight") { t.step(1); handled(); }
    else if (k === "k" || k === "ArrowLeft") { t.step(-1); handled(); }
    else if (k === "C" && e.shiftKey) { if (t.selectedLegend) t.countLegend(t.selectedLegend); handled(); }
    else if (k === "v") t.setTool("select");
    else if (k === "m") t.setTool("add");
    else if (k === "c") t.startCrop(null);
    else if (k === "e") t.setTool("exclude");
    else if (k === "r") t.setTool("room");
    else if (k === "[") cycleLeft();
    else if (k === "]") toggleRight();
    else if (k === "f") toggleFocus();
    else if (k === "b") setMode(mode === "paper" ? "blueprint" : "paper");
    else if (k === "+" || k === "=") controls.current?.zoomBy(1.25);
    else if (k === "-" || k === "_") controls.current?.zoomBy(1 / 1.25);
    else if (k === "0") controls.current?.fit();
    else if (k === "?") setDialog("shortcuts");
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { id: "count-all", group: "Actions", label: "Count all symbols on this sheet", icon: <ScanLine size={15} />, run: t.countAllOnSheet },
      ...(t.selectedLegend
        ? [{ id: "count-sel", group: "Actions", label: `Count ${t.selectedLegend.label}`, keys: "⇧C", icon: <ScanLine size={15} />, run: () => t.countLegend(t.selectedLegend!) }]
        : []),
      { id: "crop", group: "Actions", label: "Crop a new symbol sample", keys: "C", icon: <Crop size={15} />, run: () => t.startCrop(null) },
      { id: "ai", group: "Actions", label: "Ask AI to check marks", icon: <Sparkles size={15} />, run: () => setDialog("ai") },
      { id: "strong", group: "Actions", label: "Approve strong matches on this sheet", hint: "82% or more", icon: <Sparkles size={15} />, run: t.approveHighConfidence },
      { id: "clear-sheet", group: "Actions", label: "Clear all marks on this sheet", hint: "Start over; undo available", icon: <ScanLine size={15} />, run: () => t.clearMarks("sheet") },
      { id: "clear-all", group: "Actions", label: "Clear all marks on every sheet", hint: "Start over; undo available", icon: <ScanLine size={15} />, run: () => t.clearMarks("all") },
      { id: "legend-zone", group: "Actions", label: "Find and exclude the legend table", icon: <ScanLine size={15} />, run: t.detectLegendZone },
      { id: "exp-tender", group: "Export", label: "Export master tender workbook", icon: <FileSpreadsheet size={15} />, run: () => t.exportAs("tender") },
      { id: "exp-takeoff", group: "Export", label: "Export takeoff schedule", icon: <FileSpreadsheet size={15} />, run: () => t.exportAs("takeoff") },
      { id: "exp-pdf", group: "Export", label: "Export marked-up PDF", icon: <FileText size={15} />, run: () => t.exportAs("pdf") },
      { id: "v-left", group: "View", label: "Toggle left panel", keys: "[", icon: <PanelLeft size={15} />, run: cycleLeft },
      { id: "v-right", group: "View", label: "Toggle right panel", keys: "]", icon: <PanelRight size={15} />, run: toggleRight },
      { id: "v-focus", group: "View", label: "Focus mode", keys: "F", icon: <Focus size={15} />, run: toggleFocus },
      { id: "v-bp", group: "View", label: mode === "paper" ? "Blueprint drawing" : "Paper drawing", keys: "B", icon: <MapIcon size={15} />, run: () => setMode(mode === "paper" ? "blueprint" : "paper") },
      { id: "t-light", group: "View", label: "Light theme", icon: <Sun size={15} />, run: () => theme.setPref("light") },
      { id: "t-dark", group: "View", label: "Dark theme", icon: <Moon size={15} />, run: () => theme.setPref("dark") },
      { id: "t-system", group: "View", label: "Match system theme", icon: <Monitor size={15} />, run: () => theme.setPref("system") },
      { id: "lib", group: "Go to", label: "Symbol library", icon: <BookOpen size={15} />, run: () => setDialog("library") },
      { id: "settings", group: "Go to", label: "Settings", icon: <Settings size={15} />, run: () => setDialog("settings") },
      { id: "keys", group: "Go to", label: "Keyboard shortcuts", keys: "?", icon: <Keyboard size={15} />, run: () => setDialog("shortcuts") },
      { id: "plots", group: "Go to", label: "Plots and cable estimate", icon: <Download size={15} />, run: () => showRight("plots") },
    ];
    for (const p of t.project?.pages ?? []) {
      items.push({
        id: `pg${p.page_index}`,
        group: "Sheets",
        label: sheetTitle(p),
        hint: `Page ${p.page_number}${p.is_electrical ? " · electrical" : ""}`,
        icon: <Layers size={15} />,
        run: () => t.goToPage(p.page_index),
      });
    }
    for (const l of t.legends) {
      items.push({
        id: `lg${l.legend_id}`,
        group: "Symbols",
        label: l.label,
        hint: `${l.category} · ${t.counts.get(l.legend_id)?.sheet ?? 0} on this sheet`,
        icon: <SymbolSample legend={l} size={20} />,
        run: () => {
          t.setSelectedLegendId(l.legend_id);
          showLeft("symbols");
        },
      });
    }
    for (const p of t.projects) {
      if (p.project_id === t.project?.project_id) continue;
      items.push({ id: `pr${p.project_id}`, group: "Projects", label: `Open ${p.name}`, icon: <Shapes size={15} />, run: () => t.openProject(p) });
    }
    return items;
  }, [t, mode, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Tender pipeline views ----------
  if (view.name === "home") {
    return (
      <HomeView
        theme={theme.pref}
        setTheme={theme.setPref}
        onOpenTender={(id) => go({ name: "tender", id })}
        onManual={() => go({ name: "workspace" })}
      />
    );
  }
  if (view.name === "tender") {
    return (
      <TenderView
        key={view.id}
        id={view.id}
        theme={theme.pref}
        setTheme={theme.setPref}
        onHome={() => go({ name: "home" })}
        onReview={(f) => go({ name: "review", id: view.id, ...f })}
        onOpenDrawing={(ht, page) => openDrawing(ht, view.id, page)}
        apiKey={t.apiKey}
        threshold={t.threshold}
        setThreshold={t.setThreshold}
      />
    );
  }
  if (view.name === "review") {
    return (
      <ReviewQueue
        key={`${view.id}-${view.project_id}-${view.legend_id}`}
        id={view.id}
        theme={theme.pref}
        setTheme={theme.setPref}
        onHome={() => go({ name: "home" })}
        onBack={() => go({ name: "tender", id: view.id })}
        onOpenDrawing={(ht, page, markerId) => openDrawing(ht, view.id, page, markerId)}
        initial={{ project_id: view.project_id, legend_id: view.legend_id }}
        threshold={t.threshold}
        setThreshold={t.setThreshold}
      />
    );
  }

  // ---------- Full-page states ----------
  if (t.load === "offline" || t.load === "empty") {
    return (
      <div className="splash">
        <div className="splash-card">
          <div className="brand" style={{ padding: 0 }}>
            <span className="brand-mark" /> Plotline
          </div>
          {t.load === "offline" ? (
            <>
              <h1>Can't reach the takeoff engine</h1>
              <p>{t.loadError || `Nothing answered at ${API_BASE}.`} Start the backend from the repo root, then try again:</p>
              <pre>python -m uvicorn app.main:app --app-dir backend --port 8008</pre>
              <button className="btn btn-primary btn-lg" onClick={t.refreshProjects}>
                <RefreshCw size={15} /> Try again
              </button>
            </>
          ) : (
            <>
              <h1>Add your first tender pack</h1>
              <p>Upload the house-type PDF from the developer's pack. Plotline finds the electrical sheets for you.</p>
              <label className="btn btn-copper btn-lg" style={{ cursor: "pointer" }}>
                <Upload size={15} /> Upload PDF
                <input type="file" accept="application/pdf" hidden onChange={(e) => e.target.files?.[0] && t.uploadPdf(e.target.files[0])} />
              </label>
            </>
          )}
        </div>
      </div>
    );
  }

  if (t.load === "loading" || !t.project) {
    return (
      <div className="splash">
        <div className="splash-card" style={{ justifyItems: "center" }}>
          <LoaderCircle size={22} className="spin muted" />
          <p>Opening tender pack…</p>
        </div>
      </div>
    );
  }

  const lw = leftMode === "open" ? `${leftW}px` : leftMode === "rail" ? "52px" : "0px";
  const rw = rightOpen ? `${rightW}px` : "0px";

  return (
    <div className="shell">
      <AppBar
        t={t}
        leftOpen={leftMode !== "hidden"}
        rightOpen={rightOpen}
        focus={!!focusMem}
        onToggleLeft={cycleLeft}
        onToggleRight={toggleRight}
        onToggleFocus={toggleFocus}
        theme={theme.pref}
        setTheme={theme.setPref}
        onPalette={() => setDialog("palette")}
        onSettings={() => setDialog("settings")}
        onShortcuts={() => setDialog("shortcuts")}
        onLibrary={() => setDialog("library")}
        onStage={onStage}
        onHome={() => leaveWorkspace(view.tender ? { name: "tender", id: view.tender } : { name: "home" })}
        backLabel={view.tender ? "Back to tender overview" : "All tenders"}
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
      />

      <main
        className={cx("workspace", resizing && "resizing")}
        style={{ ["--lw" as string]: lw, ["--rw" as string]: rw }}
      >
        <aside className={cx("panel panel-left", leftMode === "hidden" && "hidden")} aria-label="Sheets and symbols">
          {leftMode !== "hidden" && (
            <LeftPanel
              t={t}
              tab={leftTab}
              setTab={setLeftTab}
              rail={leftMode === "rail"}
              onExpand={showLeft}
              onOpenLibrary={() => setDialog("library")}
              onNeedKey={() => setDialog("settings")}
            />
          )}
          {leftMode === "open" && (
            <div className={cx("resizer", resizing === "left" && "active")} onMouseDown={() => setResizing("left")} onDoubleClick={() => setLeftW(272)} />
          )}
        </aside>

        <section className="stage-wrap" style={{ position: "relative" }} aria-label="Drawing">
          <CanvasView t={t} mode={mode} themeKey={theme.resolved} controlsRef={controls} onScale={setScale} />
          <Toolbox t={t} />
          <ViewBox mode={mode} setMode={setMode}>
            <ZoomBox controls={controls} scale={scale} />
          </ViewBox>
          <ToolHint t={t} />
          <BusyBar t={t} />
          <ReviewDock t={t} onAICheck={() => setDialog("ai")} />
        </section>

        <aside className={cx("panel panel-right", !rightOpen && "hidden")} aria-label="Quantities">
          {rightOpen && <Inspector t={t} tab={rightTab} setTab={setRightTab} onAICheck={() => setDialog("ai")} />}
          {rightOpen && (
            <div className={cx("resizer", resizing === "right" && "active")} onMouseDown={() => setResizing("right")} onDoubleClick={() => setRightW(320)} />
          )}
        </aside>
      </main>

      {t.cropIntent && <SymbolModal t={t} intent={t.cropIntent} />}
      {t.pendingRoom && (
        <RoomModal rect={t.pendingRoom} onClose={() => t.setPendingRoom(null)} onSave={(n) => t.addRoom(n, t.pendingRoom!)} />
      )}
      {dialog === "ai" && <AICheckModal t={t} onClose={() => setDialog(null)} onNeedKey={() => setDialog("settings")} />}
      {dialog === "settings" && (
        <SettingsModal t={t} onClose={() => setDialog(null)} theme={theme.pref} setTheme={theme.setPref} mode={mode} setMode={setMode} />
      )}
      {dialog === "library" && <LibraryModal t={t} onClose={() => setDialog(null)} />}
      {dialog === "shortcuts" && <ShortcutsModal onClose={() => setDialog(null)} />}
      {dialog === "palette" && <CommandPalette items={paletteItems} onClose={() => setDialog(null)} />}
    </div>
  );
}
