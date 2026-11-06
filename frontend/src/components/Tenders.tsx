import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BookOpen, Check, Download, FileSpreadsheet, ChevronDown, ChevronRight, CircleCheck, FileText, FolderOpen, FolderUp, Layers,
  LoaderCircle, Minus, Monitor, Moon, Play, Plus, Sparkles, Sun, TriangleAlert, Upload, Zap, PencilRuler,
} from "lucide-react";
import { api, type PackFile } from "../lib/api";
import { useToast } from "../lib/toast";
import type { RunSettings, Tender, TenderHouseMarks, ThemePref } from "../lib/types";
import { baseName, cx, isApproved } from "../lib/util";
import { CostPill, refreshCosts, usd } from "./Costs";
import { AuditList } from "./AuditLog";
import { SheetPicker } from "./SheetPicker";
import { SymbolLibrary } from "./SymbolLibrary";
import type { SheetInfo } from "../lib/types";
import { MenuButton, Modal } from "./ui";
import type { AIEstimate } from "../lib/types";

/* ------------------------------------------------------------------ shared */

export function PageHeader({
  theme, setTheme, onHome, children,
}: { theme: ThemePref; setTheme: (t: ThemePref) => void; onHome: () => void; children?: React.ReactNode }) {
  const [lib, setLib] = useState(false);
  const next: ThemePref = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  return (
    <header className="appbar">
      <button className="brand brand-btn" onClick={onHome} title="All tenders">
        <span className="brand-mark" aria-hidden="true" />
        Plotline
      </button>
      <nav className="crumbs grow">{children}</nav>
      <button className="btn btn-ghost btn-sm" onClick={() => setLib(true)} title="Symbols Plotline looks for">
        <BookOpen size={14} /> Symbol library
      </button>
      {lib && <SymbolLibrary onClose={() => setLib(false)} />}
      <CostPill />
      <button className="icon-btn" aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`} onClick={() => setTheme(next)}>
        <Icon size={16} />
      </button>
    </header>
  );
}

/** Walk a dropped folder (Chrome/Edge/Safari) and keep relative paths. */
async function filesFromDrop(dt: DataTransfer): Promise<PackFile[]> {
  const out: PackFile[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files].map((f) => ({ file: f, path: f.name }));
  const walk = async (e: FileSystemEntry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file: f, path: prefix + f.name });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const c of batch) await walk(c, `${prefix}${e.name}/`);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

const keepFile = (p: PackFile) => /\.(pdf|zip|xlsx?|csv)$/i.test(p.file.name) && !p.path.includes("__MACOSX") && !p.file.name.startsWith("._");

/* ------------------------------------------------------------------ home */

export function HomeView({
  theme, setTheme, onOpenTender, onManual,
}: {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  onOpenTender: (id: string) => void;
  onManual: () => void;
}) {
  const toast = useToast();
  const [tenders, setTenders] = useState<Tender[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.tenders().then(setTenders).catch(() => setTenders([]));
  }, []);

  const upload = async (files: PackFile[]) => {
    const keep = files.filter(keepFile);
    if (!keep.length) {
      toast({ tone: "error", title: "No PDFs found", body: "Drop the tender pack folder, a zip, or the drawing PDFs." });
      return;
    }
    const mb = keep.reduce((n, f) => n + f.file.size, 0) / 1e6;
    setUploading(`Uploading ${keep.length} file${keep.length > 1 ? "s" : ""} · ${mb.toFixed(1)} MB…`);
    try {
      const t = await api.uploadTender(keep);
      onOpenTender(t.tender_id);
    } catch (e) {
      toast({ tone: "error", title: "Upload failed", body: (e as Error).message });
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="shell">
      <PageHeader theme={theme} setTheme={setTheme} onHome={() => {}} />
      <main className="page scroll">
        <div className="page-inner">
          <div className="hero-block">
            <span className="eyebrow">Jeffway Electrical · AI takeoff</span>
            <h1>Drop in a tender pack. Get every symbol, counted.</h1>
            <p>
              Plotline finds the house-type drawings and their electrical sheets, counts every symbol in the library,
              asks AI about the doubtful ones, and hands you a review queue.
            </p>
          </div>

          <div
            className={cx("dropzone", drag && "over", uploading && "busy")}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDrag(false);
              upload(await filesFromDrop(e.dataTransfer));
            }}
          >
            {uploading ? (
              <>
                <LoaderCircle size={28} className="spin" />
                <b>{uploading}</b>
              </>
            ) : (
              <>
                <FolderUp size={30} />
                <b>Drop the tender pack folder here</b>
                <span className="muted">or a .zip, or the house-type PDFs</span>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn btn-copper btn-lg" onClick={() => folderRef.current?.click()}>
                    <FolderOpen size={15} /> Choose folder
                  </button>
                  <button className="btn btn-ghost btn-lg" onClick={() => filesRef.current?.click()}>
                    <Upload size={15} /> Choose files
                  </button>
                </div>
              </>
            )}
            <input
              ref={folderRef}
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
                e.target.value = "";
                upload(fs);
              }}
            />
            <input
              ref={filesRef}
              type="file"
              hidden
              multiple
              accept=".pdf,.zip,application/pdf,application/zip"
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])].map((f) => ({ file: f, path: f.name }));
                e.target.value = "";
                upload(fs);
              }}
            />
          </div>

          <section className="stack">
            <div className="section-head">
              <h2 className="h2">Tenders</h2>
              <button className="btn btn-quiet btn-sm" onClick={onManual} title="Open a single drawing and count symbol by symbol">
                <PencilRuler size={14} /> Manual workspace
              </button>
            </div>
            {tenders === null ? (
              <div className="skeleton" style={{ height: 64 }} />
            ) : tenders.length === 0 ? (
              <p className="muted">No tenders yet. Upload one above.</p>
            ) : (
              <div className="tender-list">
                {tenders.map((t) => (
                  <button key={t.tender_id} className="tender-row" onClick={() => onOpenTender(t.tender_id)}>
                    <span className="tender-icon"><Layers size={16} /></span>
                    <span className="meta">
                      <b>{t.name}</b>
                      <span className="muted">
                        {t.house_types.length} house type{t.house_types.length === 1 ? "" : "s"} ·{" "}
                        {t.house_types.reduce((n, h) => n + h.electrical_pages.length, 0)} electrical sheets · {t.created_at}
                      </span>
                    </span>
                    <StatusPill t={t} />
                    <ChevronRight size={16} className="muted" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function StatusPill({ t }: { t: Tender }) {
  if (t.status === "done") return <span className="pill pill-ok">Ready to review</span>;
  if (t.status === "running") return <span className="pill pill-ai">Running</span>;
  if (t.status === "failed") return <span className="pill pill-reject">Failed</span>;
  return <span className="pill pill-plain">Not run</span>;
}

/* ------------------------------------------------------------------ tender */

const STAGES = [
  { id: "sheets", label: "Read the pack and render electrical sheets" },
  { id: "matching", label: "First pass: find every library symbol" },
  { id: "ai", label: "Second pass: AI checks borderline marks" },
  { id: "saving", label: "Build the takeoff" },
];

export function TenderView({
  id, theme, setTheme, onHome, onReview, onOpenDrawing, apiKey, threshold, setThreshold,
}: {
  id: string;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  onHome: () => void;
  onReview: (filter?: { project_id?: string; legend_id?: string }) => void;
  onOpenDrawing: (ht: { project_id: string; name: string; filepath: string; filename?: string }, page?: number) => void;
  apiKey: string;
  threshold: number;
  setThreshold: (n: number) => void;
}) {
  const toast = useToast();
  const [t, setT] = useState<Tender | null>(null);
  const [marks, setMarks] = useState<TenderHouseMarks[] | null>(null);

  const load = useCallback(async () => {
    try {
      const x = await api.tender(id);
      setT(x);
      if (x.status === "done" || x.status === "running") setMarks((await api.tenderMarks(id)).house_types);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't load tender", body: (e as Error).message });
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates while counting or an AI check runs: the tender every 1.5 s, its marks whenever a sheet lands
  const counting = t?.status === "running";
  const aiRunning = !!t?.ai_progress?.running;
  const lastSheets = useRef<number>(-1);
  const wasAI = useRef(false);
  useEffect(() => {
    if (!counting && !aiRunning) return;
    const h = setInterval(async () => {
      const x = await api.tender(id).catch(() => null);
      if (!x) return;
      setT(x);
      const sheetsDone = x.progress?.sheets_done ?? 0;
      const finished = x.status === "done";
      if (sheetsDone !== lastSheets.current || finished || x.ai_progress?.running) {
        lastSheets.current = sheetsDone;
        const m = await api.tenderMarks(id).catch(() => null);
        if (m) setMarks(m.house_types);
      }
      if (finished && counting) {
        refreshCosts();
        toast(
          x.progress?.stopped
            ? { tone: "info", title: "Counting stopped", body: x.progress.message }
            : { tone: "success", title: "Takeoff complete", body: "Every sheet is counted." },
        );
      }
    }, 1500);
    return () => clearInterval(h);
  }, [counting, aiRunning, id, toast]);

  // Tell the user when a background AI check finishes
  useEffect(() => {
    if (wasAI.current && !aiRunning && t?.ai_progress) {
      refreshCosts();
      api.tenderMarks(id).then((m) => setMarks(m.house_types)).catch(() => {});
      toast({
        tone: t.ai_progress.failed ? "error" : "success",
        title: t.ai_progress.failed ? "AI check failed" : "AI check finished",
        body: t.ai_progress.message,
      });
    }
    wasAI.current = aiRunning;
  }, [aiRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (s: Partial<RunSettings>) => {
    try {
      lastSheets.current = -1;
      setT(await api.runTender(id, { ...s, api_key: apiKey || undefined }));
      setMarks((await api.tenderMarks(id)).house_types);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't start", body: (e as Error).message });
    }
  };

  const firstSheetDone = (t?.progress?.sheets_done ?? 0) > 0;

  return (
    <div className="shell">
      <PageHeader theme={theme} setTheme={setTheme} onHome={onHome}>
        <span className="sep">/</span>
        <span className="crumb-btn" style={{ cursor: "default" }}>
          <b className="truncate">{t?.name ?? "Tender"}</b>
        </span>
      </PageHeader>
      <main className="page scroll">
        <div className="page-inner">
          {!t ? (
            <div className="skeleton" style={{ height: 160 }} />
          ) : t.status === "uploaded" || t.status === "failed" ? (
            <RunPanel t={t} onRun={run} hasKey={!!apiKey} />
          ) : counting && !firstSheetDone ? (
            <Progress t={t} onStop={async () => setT(await api.stopTender(id))} />
          ) : marks ? (
            <>
              {counting && <LiveBanner t={t} onStop={async () => setT(await api.stopTender(id))} onReview={() => onReview()} />}
              {!counting && t.progress?.stopped && (
                <div className="live-banner" style={{ boxShadow: "var(--shadow-1), inset 3px 0 0 var(--review)" }}>
                  <TriangleAlert size={16} style={{ color: "var(--review)", flex: "none" }} />
                  <div className="grow">
                    <b>{t.progress.message}</b>
                    <small className="muted" style={{ display: "block" }}>
                      Everything counted so far is in the review queue. Continue picks up with the sheets not yet done.
                    </small>
                  </div>
                  <button className="btn btn-copper" onClick={() => run({ ...t.settings, resume: true })}>
                    <Play size={14} /> Continue counting
                  </button>
                </div>
              )}
              <Overview
                t={t}
                marks={marks}
                threshold={threshold}
                setThreshold={setThreshold}
                onReview={onReview}
                onOpenDrawing={onOpenDrawing}
                onRerun={() => setT({ ...t, status: "uploaded" })}
                apiKey={apiKey}
                onAIStarted={(nt) => setT(nt)}
                onPlots={async (pid, n) => {
                  setMarks((ms) => ms?.map((h) => (h.project_id === pid ? { ...h, plots: n } : h)) ?? null);
                  const nt = await api.setPlots(id, pid, n).catch(() => null);
                  if (nt) setT(nt);
                }}
              />
            </>
          ) : (
            <div className="skeleton" style={{ height: 160 }} />
          )}
        </div>
      </main>
    </div>
  );
}

/** Shown on the overview while counting carries on in the background. */
function LiveBanner({ t, onStop, onReview }: { t: Tender; onStop: () => void; onReview: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);
  const p = t.progress;
  const pct = p.total ? p.done / p.total : 0;
  const elapsed = p.started_at ? now / 1000 - p.started_at : 0;
  const remaining = pct > 0.02 ? (elapsed / pct) * (1 - pct) : null;
  const fmt = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m` : `${Math.max(1, Math.round(sec / 60))} min`);
  return (
    <div className="live-banner">
      <span className="live-dot" aria-hidden="true" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <b>
            Still counting · {p.sheets_done ?? 0} of {p.sheets_total ?? "?"} sheets done · {p.marks_found ?? 0} marks so far
          </b>
          <span className="muted">
            {t.cancel ? "Stopping after this sheet…" : remaining != null ? `About ${fmt(remaining)} left` : "Working out time left…"}
          </span>
        </div>
        <div className="progress-line"><i style={{ width: `${pct * 100}%` }} /></div>
        <small className="muted truncate" style={{ display: "block" }}>
          Now: {p.current ?? p.message}. Finished sheets are already in the review queue, and the AI check can run on them now.
        </small>
      </div>
      <button className="btn btn-copper" onClick={onReview}>Review what's found <ArrowRight size={14} /></button>
      <button className="btn btn-ghost" disabled={!!t.cancel} onClick={onStop} title="Stop after the sheet it's on. Everything counted so far stays.">
        {t.cancel ? "Stopping…" : "Stop"}
      </button>
    </div>
  );
}

function RunPanel({ t, onRun, hasKey }: { t: Tender; onRun: (s: Partial<RunSettings>) => void; hasKey: boolean }) {
  const [aiMode, setAiMode] = useState<"auto" | "manual" | "off">(
    t.settings?.use_ai === false ? "off" : (t.settings?.ai_mode ?? "manual"),
  );
  const useAI = aiMode !== "off";
  const [schedule, setSchedule] = useState(t.schedule ?? null);
  const [houses, setHouses] = useState(t.house_types);
  const [docs, setDocs] = useState(t.documents);
  const [picking, setPicking] = useState<
    { relPath: string; filepath: string; sheets: SheetInfo[]; selected: number[] } | null
  >(null);
  const applyTender = (nt: Tender) => {
    setHouses(nt.house_types);
    setDocs(nt.documents);
    setSchedule(nt.schedule ?? null);
  };
  const schedRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [quick, setQuick] = useState(t.settings?.quick ?? false);
  const [high, setHigh] = useState(t.settings?.auto_high ?? 0.85);
  const [low, setLow] = useState(t.settings?.ai_low ?? 0.6);
  const [cap, setCap] = useState(t.settings?.max_ai_marks ?? 400);
  const [showDocs, setShowDocs] = useState(false);
  const sheets = houses.reduce((n, h) => n + h.electrical_pages.length, 0);
  const maybeDocs = docs.filter((d) => (d.maybe ?? 0) > 0);

  return (
    <div className="stack">
      <div className="hero-block">
        <span className="eyebrow">Step 1 of 2 · Check the pack</span>
        <h1>{t.name}</h1>
        <p>
          Found <b>{houses.length}</b> house-type drawing{houses.length === 1 ? "" : "s"} with{" "}
          <b>{sheets}</b> electrical sheets. {docs.length} other document{docs.length === 1 ? "" : "s"} set aside.
          Click a drawing to check exactly which sheets get counted.
        </p>
        {t.progress?.interrupted && t.status === "uploaded" && (
          <div className="callout">
            <TriangleAlert size={14} style={{ color: "var(--review)" }} /> The last run was interrupted before any sheet finished. Run it again.
          </div>
        )}
        {t.status === "failed" && (
          <div className="callout" style={{ color: "var(--reject)" }}>
            <TriangleAlert size={14} /> {t.progress?.message}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-head">
            <span className="eyebrow">House types · sheets to count</span>
          </div>
          <div className="list" style={{ padding: 0 }}>
            {houses.map((h) => {
              const maybe = (h.sheets ?? []).filter((s) => s.verdict === "maybe" && !h.electrical_pages.some((p) => p.page_index === s.page_index)).length;
              return (
                <button
                  key={h.project_id}
                  className="item pdf-row"
                  onClick={() =>
                    setPicking({ relPath: h.rel_path, filepath: h.filepath, sheets: h.sheets ?? [], selected: h.electrical_pages.map((p) => p.page_index) })
                  }
                  title="Check which sheets are counted"
                >
                  <span className="tender-icon"><FileText size={15} /></span>
                  <span className="meta">
                    <span className="title">{h.name}</span>
                    <span className="sub">{h.electrical_pages.map((p) => p.title || `p.${p.page_number}`).join(" · ")}</span>
                  </span>
                  {h.sheets_confirmed ? (
                    <span className="pill pill-ok" title="You checked these sheets"><Check size={11} /> {h.electrical_pages.length} sheets</span>
                  ) : (
                    <span className="badge-count">{h.electrical_pages.length} sheets</span>
                  )}
                  {maybe > 0 && !h.sheets_confirmed && <span className="pill pill-review" title="Sheets that might be electrical">{maybe} to check</span>}
                  <PlotsBadge h={h} />
                  <ChevronRight size={15} className="muted" />
                </button>
              );
            })}
            {houses.length === 0 && <p className="muted">No drawings with electrical sheets were found. Open a PDF under other documents to pick sheets by hand.</p>}
          </div>
          <div className={cx("callout", schedule && "ok")}>
            <FileText size={14} />
            <span className="grow">
              {schedule ? (
                <>
                  <b>Accommodation schedule:</b> {baseName(schedule.file)} · {schedule.total} plots ·{" "}
                  {houses.filter((h) => h.plots_source?.file).length} of {houses.length} house types matched
                </>
              ) : (
                <>No accommodation schedule found in the pack, so every house type starts at 1 plot.</>
              )}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => schedRef.current?.click()}>
              {schedule ? "Replace" : "Add schedule"}
            </button>
            <input ref={schedRef} type="file" hidden accept=".xlsx,.xlsm,.csv" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const nt = await api.uploadSchedule(t.tender_id, f);
                setSchedule(nt.schedule ?? null);
                setHouses(nt.house_types);
                toast({ tone: "success", title: "Plots read from the schedule" });
              } catch (err) {
                toast({ tone: "error", title: "Couldn't read that schedule", body: (err as Error).message });
              }
            }} />
          </div>
          {maybeDocs.length > 0 && (
            <div className="callout">
              <TriangleAlert size={14} style={{ color: "var(--review)" }} />
              <span>
                {maybeDocs.length} other PDF{maybeDocs.length === 1 ? " has" : "s have"} sheets that might be electrical. Open{" "}
                {maybeDocs.length === 1 ? "it" : "them"} below to include any.
              </span>
            </div>
          )}
          {docs.length > 0 && (
            <>
              <button className="btn btn-quiet btn-sm" style={{ justifySelf: "start" }} onClick={() => setShowDocs(!showDocs)}>
                {showDocs ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Other documents ({docs.length})
              </button>
              {(showDocs || maybeDocs.length > 0) && (
                <div className="list" style={{ padding: 0 }}>
                  {docs
                    .filter((d) => showDocs || (d.maybe ?? 0) > 0)
                    .map((d) =>
                      d.kind === "pdf" && d.sheets && d.filepath ? (
                        <button
                          key={d.path}
                          className="item pdf-row"
                          onClick={() => setPicking({ relPath: d.path, filepath: d.filepath!, sheets: d.sheets!, selected: [] })}
                          title="Pick sheets from this PDF"
                        >
                          <span className="meta">
                            <span className="title truncate">{baseName(d.path)}</span>
                            <span className="sub">{d.pages} pages · not counted</span>
                          </span>
                          {(d.maybe ?? 0) > 0 && <span className="pill pill-review">{d.maybe} to check</span>}
                          <ChevronRight size={15} className="muted" />
                        </button>
                      ) : (
                        <div key={d.path} className="item" style={{ cursor: "default" }}>
                          <span className="meta"><span className="sub truncate">{d.path}</span></span>
                        </div>
                      ),
                    )}
                </div>
              )}
            </>
          )}
          {picking && (
            <SheetPicker
              tenderId={t.tender_id}
              relPath={picking.relPath}
              filepath={picking.filepath}
              sheets={picking.sheets}
              selected={picking.selected}
              onClose={() => setPicking(null)}
              onSaved={applyTender}
            />
          )}
        </div>

        <div className="card">
          <div className="section-head">
            <span className="eyebrow">How to run</span>
          </div>
          <div className="field">
            <label>AI second pass on borderline marks ({Math.round(low * 100)}–{Math.round(high * 100)}%)</label>
            <div className="seg" role="group" style={{ justifySelf: "start" }}>
              <button type="button" aria-pressed={aiMode === "manual"} onClick={() => setAiMode("manual")}>Later, when I choose</button>
              <button type="button" aria-pressed={aiMode === "auto"} onClick={() => setAiMode("auto")}>Right after counting</button>
              <button type="button" aria-pressed={aiMode === "off"} onClick={() => setAiMode("off")}>Off</button>
            </div>
            <span className="hint">
              {aiMode === "manual"
                ? "Counting finishes with no AI spend. You see exactly how many marks AI would check, and the estimated cost, before you run it."
                : aiMode === "auto"
                  ? `AI runs straight after counting, up to the budget below.${hasKey ? "" : " Uses the server's OpenAI key."}`
                  : "No AI. Borderline marks wait for a person."}
            </span>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} />
            <span>
              <b>Quick scan</b>
              <small>One scale instead of three. About 3× faster, may miss a few fittings.</small>
            </span>
          </label>
          <div className="bands">
            <div className="band-bar">
              <i style={{ width: `${low * 100}%`, background: "var(--surface-3)" }} />
              <i style={{ width: `${(high - low) * 100}%`, background: useAI ? "var(--ai)" : "var(--review)" }} />
              <i style={{ width: `${(1 - high) * 100}%`, background: "var(--ok)" }} />
            </div>
            <div className="band-legend">
              <span>Below {Math.round(low * 100)}%: {useAI ? "kept, hidden" : "hidden"}</span>
              <span>{useAI ? "AI checks" : "You review"}</span>
              <span>{Math.round(high * 100)}%+: strong</span>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="low">AI from</label>
                <input id="low" type="range" className="slider" min={0.55} max={0.8} step={0.01} value={low} onChange={(e) => setLow(Number(e.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="high">Strong from</label>
                <input id="high" type="range" className="slider" min={0.75} max={0.95} step={0.01} value={high} onChange={(e) => setHigh(Number(e.target.value))} />
              </div>
            </div>
            {aiMode === "auto" && (
              <div className="field">
                <label htmlFor="cap">AI budget: at most {cap} marks (≈ {Math.ceil(cap / 8)} AI calls)</label>
                <input id="cap" type="range" className="slider" min={50} max={1500} step={50} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
              </div>
            )}
          </div>
          <button
            className="btn btn-copper btn-lg"
            disabled={!houses.length}
            onClick={() => onRun({ use_ai: useAI, ai_mode: aiMode === "auto" ? "auto" : "manual", quick, auto_high: high, ai_low: low, max_ai_marks: cap })}
          >
            <Play size={15} /> Run full takeoff
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Roughly {Math.max(1, Math.round((sheets * 31 * (quick ? 0.5 : 1.3)) / 60))} min for {sheets} sheets on a 4-core machine.
          </span>
        </div>
      </div>
    </div>
  );
}

function Progress({ t, onStop }: { t: Tender; onStop: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);
  const p = t.progress;
  const idx = STAGES.findIndex((s) => s.id === p.stage);
  const pct = p.total ? (p.done / p.total) * 100 : 0;
  const secs = p.started_at ? Math.round(now / 1000 - p.started_at) : 0;
  return (
    <div className="stack" style={{ maxWidth: 680, margin: "40px auto" }}>
      <div className="hero-block">
        <span className="eyebrow">Step 2 of 2 · Running · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
        <h1>{p.ai_only ? `AI is checking ${t.name}` : `Counting ${t.name}`}</h1>
        <p>
          {p.sheets_total ? `${p.sheets_total} sheets to count. ` : ""}The review queue opens as soon as the first sheet is done, and
          fills up while the rest are counted.
        </p>
        <div className="row">
          <button className="btn btn-ghost" disabled={!!t.cancel} onClick={onStop} title="Stop after the sheet it's on">
            {t.cancel ? "Stopping after this sheet…" : "Stop"}
          </button>
        </div>
      </div>
      <div className="card">
        <ol className="stages">
          {STAGES.map((s, i) => {
            const state = i < idx ? "done" : i === idx ? "now" : "todo";
            const skipped = s.id === "ai" && !t.settings?.use_ai;
            return (
              <li key={s.id} className={cx("stage", state, skipped && "skipped")}>
                <span className="stage-dot">
                  {state === "done" ? <Check size={12} /> : state === "now" ? <LoaderCircle size={12} className="spin" /> : null}
                </span>
                <div className="grow">
                  <b>{s.label}</b>
                  {skipped && <small className="muted"> · off</small>}
                  {state === "now" && (
                    <>
                      <div className="progress-line"><i style={{ width: `${pct}%` }} /></div>
                      <small className="muted truncate" style={{ display: "block" }}>
                        {p.total ? `${p.done} / ${p.total} · ` : ""}
                        {p.message}
                      </small>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Overview({
  t, marks, threshold, setThreshold, onReview, onOpenDrawing, onRerun, onPlots, apiKey, onAIStarted,
}: {
  t: Tender;
  marks: TenderHouseMarks[];
  threshold: number;
  setThreshold: (n: number) => void;
  onReview: (filter?: { project_id?: string; legend_id?: string }) => void;
  onOpenDrawing: (ht: { project_id: string; name: string; filepath: string }, page?: number) => void;
  onRerun: () => void;
  onPlots: (pid: string, n: number) => void;
  apiKey: string;
  onAIStarted: (t: Tender) => void;
}) {
  const [open, setOpen] = useState<string | null>(marks[0]?.project_id ?? null);
  const toast = useToast();
  const exportWb = async (mode: "counted" | "approved") => {
    toast({ tone: "info", title: "Building the workbook…" });
    try {
      await api.exportTenderWorkbook(t.tender_id, t.name, mode, threshold);
      toast({ tone: "success", title: "Workbook downloaded", body: "Open the “Plotline takeoff” sheet first to see what was filled in." });
    } catch (e) {
      toast({ tone: "error", title: "Export failed", body: (e as Error).message });
    }
  };

  const counted = (m: TenderHouseMarks["markers"][number]) => isApproved(m) || m.confidence_score >= threshold;

  const data = useMemo(() => {
    const legends = new Map<string, { label: string; color: string; stage: string }>();
    for (const h of marks) for (const l of h.legends) legends.set(l.legend_id, { label: l.label, color: l.color, stage: l.fix_stage });
    const matrix = new Map<string, Map<string, number>>();
    let found = 0, toReview = 0, approved = 0, aiConfirmed = 0;
    const perHouse = new Map<string, { found: number; review: number; approved: number; pages: Map<number, number> }>();
    for (const h of marks) {
      const ph = { found: 0, review: 0, approved: 0, pages: new Map<number, number>() };
      for (const m of h.markers) {
        if (!counted(m)) continue;
        found++;
        ph.found++;
        ph.pages.set(m.page_index, (ph.pages.get(m.page_index) ?? 0) + 1);
        if (isApproved(m)) {
          approved++;
          ph.approved++;
        } else {
          toReview++;
          ph.review++;
          if (m.status === "ai_verified") aiConfirmed++;
        }
        const row = matrix.get(m.legend_id) ?? new Map<string, number>();
        row.set(h.project_id, (row.get(h.project_id) ?? 0) + 1);
        matrix.set(m.legend_id, row);
      }
      perHouse.set(h.project_id, ph);
    }
    const rows = [...matrix.entries()]
      .map(([lid, row]) => ({ lid, row, total: [...row.values()].reduce((a, b) => a + b, 0), ...(legends.get(lid) ?? { label: lid, color: "#999", stage: "" }) }))
      .sort((a, b) => b.total - a.total);
    return { rows, found, toReview, approved, aiConfirmed, perHouse };
  }, [marks, threshold]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheets = marks.reduce((n, h) => n + h.electrical_pages.length, 0);
  const ai = t.ai;

  return (
    <div className="stack">
      <div className="overview-head">
        <div className="hero-block">
          <span className="eyebrow">
            {t.status === "running"
              ? "Takeoff · counting in the background"
              : `Takeoff · ${t.finished_at ?? ""}${t.duration_s ? ` · ${Math.floor(t.duration_s / 60)}m ${t.duration_s % 60}s` : ""}${t.progress?.stopped ? " · stopped early" : ""}`}
          </span>
          <h1>{t.name}</h1>
        </div>
        <div className="row">
          <MenuButton
            label="Export tender workbook"
            className="btn btn-ghost"
            align="right"
            trigger={<><Download size={14} /> Export workbook</>}
          >
            {(close) => (
              <>
                <div className="label eyebrow">Jeffway tender workbook · all house types</div>
                <button className="menu-item" onClick={() => { close(); exportWb("counted"); }}>
                  <FileSpreadsheet size={15} />
                  <span className="meta">
                    Counted marks
                    <small>Approved, AI-confirmed and unreviewed ≥ {Math.round(threshold * 100)}%: matches the numbers on this page</small>
                  </span>
                </button>
                <button className="menu-item" onClick={() => { close(); exportWb("approved"); }}>
                  <FileSpreadsheet size={15} />
                  <span className="meta">
                    Approved marks only
                    <small>Just what a person has approved in the review queue</small>
                  </span>
                </button>
                <hr />
                <div className="label muted" style={{ fontSize: 11.5, maxWidth: 300, lineHeight: 1.45 }}>
                  Starts from a blank copy of the workbook: every old quantity and plot count is cleared, then only
                  Plotline's counts and plots are filled in. A "Plotline takeoff" sheet shows where each number came from.
                </div>
              </>
            )}
          </MenuButton>
          <button className="btn btn-ghost" onClick={onRerun} disabled={t.status === "running"}>
            <Zap size={14} /> Run again
          </button>
          <button className="btn btn-copper btn-lg" onClick={() => onReview()} disabled={!data.toReview && t.status !== "running"}>
            Start review queue <span className="kbd">{data.toReview}</span> <ArrowRight size={15} />
          </button>
        </div>
      </div>

      <div className="tiles">
        <div className="tile"><b>{marks.length}</b><span>House types</span></div>
        <div className="tile"><b>{sheets}</b><span>Electrical sheets</span></div>
        <div className="tile"><b>{data.found}</b><span>Symbols found ≥ {Math.round(threshold * 100)}%</span></div>
        <div className="tile">
          <b>{ai ? ai.kept + ai.removed : "–"}</b>
          <span>
            {ai
              ? ai.error && !ai.checked
                ? "Last AI check failed"
                : `AI checked · kept ${ai.kept}, removed ${ai.removed}`
              : t.settings?.use_ai === false
                ? "AI check off"
                : "AI not run yet · see below"}
          </span>
        </div>
        <div className="tile accent">
          <b>{data.toReview}</b>
          <span>
            Waiting for you · {data.approved} approved
            {data.aiConfirmed > 0 && <><br />{data.aiConfirmed} AI-confirmed · {data.toReview - data.aiConfirmed} not checked by AI</>}
          </span>
        </div>
      </div>
      {t.layer_check && (t.layer_check.down > 0 || t.layer_check.possible_missed > 0) && (
        <div className="callout">
          <Layers size={14} />
          <span>
            <b>Free checks (no AI):</b> {t.layer_check.confirmed} borderline marks confirmed from the CAD file (same CAD block, layer or
            legend letter); {t.layer_check.down} marked down (wrong layer, or a repeat on a kitchen/bathroom layout).
            {t.layer_check.found ? ` ${t.layer_check.found} items the image match missed were added.` : ""}
            {t.layer_check.gangs ? ` ${t.layer_check.gangs} switch pairs counted as 2-gang plates.` : ""}
            {t.layer_check.room_rule ? ` ${t.layer_check.room_rule} downlights set to IP/standard by room.` : ""}{" "}
            {t.layer_check.possible_missed > 0 && `${t.layer_check.possible_missed} possible misses are waiting under "Possible misses" in the review queue.`}
          </span>
        </div>
      )}
      {ai?.error && (
        <div className="callout" style={{ color: "var(--reject)" }}>
          <TriangleAlert size={14} />
          <span>
            AI second pass didn't run fully: {ai.error}. Borderline marks are left for you to review; lower the threshold to see them.
          </span>
        </div>
      )}

      <AIPanel t={t} apiKey={apiKey} onStarted={onAIStarted} />

      <div className="card row" style={{ gap: 16 }}>
        <span className="eyebrow" style={{ whiteSpace: "nowrap" }}>Count marks scoring at least</span>
        <input type="range" className="slider grow" min={0.55} max={0.95} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        <b className="mono" style={{ minWidth: 44 }}>{Math.round(threshold * 100)}%</b>
      </div>

      <div className="grid-overview">
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">House types</span>
          {marks.map((h) => {
            const ph = data.perHouse.get(h.project_id)!;
            const isOpen = open === h.project_id;
            const done = ph.found ? ph.approved / ph.found : 0;
            return (
              <div key={h.project_id} className={cx("ht-card", isOpen && "open")}>
                <button className="ht-head" onClick={() => setOpen(isOpen ? null : h.project_id)}>
                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <span className="grow" style={{ textAlign: "left" }}>
                    <b>{h.name}</b>
                    <small className="muted" style={{ display: "block" }}>
                      {ph.found} symbols · {h.electrical_pages.length} sheets
                    </small>
                  </span>
                  {ph.review === 0 && ph.found > 0 ? (
                    <span className="pill pill-ok">Reviewed</span>
                  ) : (
                    <span className="pill pill-review">{ph.review} to review</span>
                  )}
                </button>
                <div className="stackbar" style={{ margin: "0 14px" }}><i style={{ width: `${done * 100}%`, background: "var(--ok)" }} /></div>
                {isOpen && (
                  <div className="ht-body">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="muted row" style={{ gap: 6 }}>
                        Plots
                        <PlotsBadge h={{ plots: h.plots, plots_source: t.house_types.find((x) => x.project_id === h.project_id)?.plots_source }} />
                      </span>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="icon-btn icon-btn-sm" aria-label="Fewer plots" onClick={() => onPlots(h.project_id, Math.max(1, h.plots - 1))}><Minus size={13} /></button>
                        <input className="input mono" style={{ width: 52, height: 26, textAlign: "center" }} type="number" min={1} value={h.plots}
                          onChange={(e) => onPlots(h.project_id, Math.max(1, Number(e.target.value) || 1))} aria-label="Plots" />
                        <button className="icon-btn icon-btn-sm" aria-label="More plots" onClick={() => onPlots(h.project_id, h.plots + 1)}><Plus size={13} /></button>
                      </div>
                    </div>
                    <div className="list" style={{ padding: 0 }}>
                      {h.electrical_pages.map((p) => (
                        <button key={p.page_index} className="item" onClick={() => onOpenDrawing(h, p.page_index)}>
                          <span className="thumb"><img loading="lazy" src={api.thumbnailUrl(h.filepath, p.page_index)} alt="" /></span>
                          <span className="meta">
                            <span className="title">{p.title || `Page ${p.page_number}`}</span>
                            <span className="sub mono">p.{p.page_number}</span>
                          </span>
                          {t.status === "running" && t.sheet_state?.[`${h.project_id}:${p.page_index}`] !== "done" ? (
                            t.sheet_state?.[`${h.project_id}:${p.page_index}`] === "running" ? (
                              <span className="pill pill-ai"><LoaderCircle size={11} className="spin" /> Counting</span>
                            ) : (
                              <span className="pill pill-plain">Waiting</span>
                            )
                          ) : (
                            <span className="badge-count">{ph.pages.get(p.page_index) ?? 0}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="row">
                      <button className="btn btn-primary btn-sm grow" disabled={!ph.review} onClick={() => onReview({ project_id: h.project_id })}>
                        Review this house type
                      </button>
                      <button className="btn btn-ghost btn-sm grow" onClick={() => onOpenDrawing(h)}>
                        Open drawings <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="section-head" style={{ padding: "12px 14px" }}>
            <span className="eyebrow">Symbols across the tender</span>
            <span className="muted" style={{ fontSize: 12 }}>Click a row to review just that symbol</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="boq">
              <thead>
                <tr>
                  <th>Symbol</th>
                  {marks.map((h) => <th key={h.project_id} title={h.name}>{h.name.replace(/^The /, "").slice(0, 12)}</th>)}
                  <th>Per set</th>
                  <th title="Each house type × its plots">× plots</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.lid} className="click" onClick={() => onReview({ legend_id: r.lid })}>
                    <td>
                      <span className="label" style={{ maxWidth: 260 }}>
                        <span className="swatch" style={{ background: r.color }} />
                        <span title={r.label}>{r.label}</span>
                      </span>
                    </td>
                    {marks.map((h) => (
                      <td key={h.project_id} className={cx("num", !r.row.get(h.project_id) && "zero")}>{r.row.get(h.project_id) ?? 0}</td>
                    ))}
                    <td className="num">{r.total}</td>
                    <td className="num">{marks.reduce((n, h) => n + (r.row.get(h.project_id) ?? 0) * h.plots, 0)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={marks.length + 3} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    <CircleCheck size={16} /> Nothing above {Math.round(threshold * 100)}%. Lower the slider to see weaker matches.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        <Sparkles size={12} /> Counts include approved marks plus unreviewed marks at or above the threshold. Approve or delete them in the
        review queue to firm up the numbers.
      </p>
    </div>
  );
}

function PlotsBadge({ h }: { h: { plots: number; plots_source?: { file?: string; matched?: string[]; manual?: boolean } | null } }) {
  const src = h.plots_source;
  const title = src?.file
    ? `From ${src.file}: ${src.matched?.join(" + ")}`
    : src?.manual
      ? "Set by hand"
      : "Not found in the accommodation schedule";
  return (
    <span className={cx("pill", src?.file ? "pill-ok" : src?.manual ? "pill-plain" : "pill-review")} title={title}>
      {h.plots} plot{h.plots === 1 ? "" : "s"}
    </span>
  );
}

function AIPanel({
  t, onStarted, apiKey,
}: { t: Tender; onStarted: (t: Tender) => void; apiKey: string }) {
  const toast = useToast();
  const [low, setLow] = useState(t.settings?.ai_low ?? 0.6);
  const [high, setHigh] = useState(t.settings?.auto_high ?? 0.85);
  const [cap, setCap] = useState(0);
  const [house, setHouse] = useState("");
  const [est, setEst] = useState<AIEstimate | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let alive = true;
    const h = setTimeout(() => {
      api
        .aiEstimate(t.tender_id, { ai_low: low, auto_high: high, max_ai_marks: cap, project_ids: house ? [house] : undefined })
        .then((e) => alive && setEst(e))
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [t.tender_id, low, high, cap, house, t.ai_runs?.length, t.progress?.sheets_done, t.ai_progress?.running]);

  const spent = (t.ai_runs ?? []).reduce((n, r) => n + (r.cost ?? 0), 0);

  const start = async () => {
    try {
      const nt = await api.aiRun(t.tender_id, {
        ai_low: low, auto_high: high, max_ai_marks: cap, api_key: apiKey || undefined, project_ids: house ? [house] : undefined,
      });
      setConfirm(false);
      onStarted(nt);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't start the AI check", body: (e as Error).message });
    }
  };

  return (
    <div className="card ai-panel">
      <div className="section-head">
        <span className="row" style={{ gap: 8 }}>
          <Sparkles size={16} style={{ color: "var(--ai)" }} />
          <b>AI second pass</b>
          <span className="muted">checks borderline marks and removes the false ones</span>
        </span>
        <span className="row">
          {spent > 0 && <span className="muted">Spent on this tender: <b className="mono" style={{ color: "var(--fg)" }}>{usd(spent)}</b></span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowLog(true)}>AI decisions log</button>
        </span>
        {showLog && (
          <Modal wide title="AI decisions" subtitle="Every AI call for this tender: open one to see the images it was sent and its verdict on each." onClose={() => setShowLog(false)}>
            <AuditList tag={t.tender_id} />
          </Modal>
        )}
      </div>
      <div className="ai-grid">
        <div className="field">
          <label htmlFor="ai-low">Marks scoring from {Math.round(low * 100)}%</label>
          <input id="ai-low" type="range" className="slider" min={0.55} max={0.84} step={0.01} value={low} onChange={(e) => setLow(Math.min(Number(e.target.value), high - 0.01))} />
        </div>
        <div className="field">
          <label htmlFor="ai-high">up to {Math.round(high * 100)}%</label>
          <input id="ai-high" type="range" className="slider" min={0.7} max={1} step={0.01} value={high} onChange={(e) => setHigh(Math.max(Number(e.target.value), low + 0.01))} />
        </div>
        <div className="field">
          <label htmlFor="ai-house">House types</label>
          <select id="ai-house" className="select" value={house} onChange={(e) => setHouse(e.target.value)}>
            <option value="">All</option>
            {t.house_types.map((h) => <option key={h.project_id} value={h.project_id}>{h.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ai-cap">Budget: {cap ? `at most ${cap} marks` : "no limit"}</label>
          <input id="ai-cap" type="range" className="slider" min={0} max={Math.max(50, est?.available ?? 50)} step={10} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </div>
      </div>
      {t.ai_progress?.running && (
        <div className="callout">
          <LoaderCircle size={14} className="spin" style={{ color: "var(--ai)" }} />
          <span className="grow">
            {t.ai_progress.message}
            <span className="progress-line" style={{ display: "block" }}>
              <i style={{ width: `${t.ai_progress.total ? (t.ai_progress.done / t.ai_progress.total) * 100 : 3}%`, background: "var(--ai)" }} />
            </span>
          </span>
        </div>
      )}
      {t.status === "running" && !t.ai_progress?.running && (
        <span className="muted" style={{ fontSize: 12 }}>
          Counting is still running. The AI check covers marks found so far; run it again later for the rest. Marks it has
          already seen are never re-sent.
        </span>
      )}
      <div className="estimate">
        <div><b className="mono">{est?.marks ?? "–"}</b><span>marks to check{est && est.available > est.marks ? ` of ${est.available}` : ""}</span></div>
        <div><b className="mono">{est?.calls ?? "–"}</b><span>AI calls</span></div>
        <div className="accent"><b className="mono">{est ? usd(est.estimated_cost) : "–"}</b><span>estimated cost</span></div>
        <div className="grow" style={{ textAlign: "right" }}>
          {confirm ? (
            <span className="row" style={{ justifyContent: "flex-end" }}>
              <span className="muted">Spend about {usd(est?.estimated_cost)}?</span>
              <button className="btn btn-copper" onClick={start}>Yes, run it</button>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn btn-primary btn-lg" disabled={!est?.marks || !!t.ai_progress?.running} onClick={() => setConfirm(true)}>
              <Sparkles size={15} /> {t.ai_progress?.running ? "AI check running…" : "Run AI check"}
            </button>
          )}
        </div>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        {usd(est?.cost_per_call, 3)} per call of up to 8 marks ({est?.basis ?? "estimate"}). Marks AI has already seen are not sent again.
        {(t.ai_runs ?? []).length > 0 &&
          ` Previous runs: ${(t.ai_runs ?? []).map((r) => (r.error && !r.checked ? `${r.at ?? ""} failed` : `${r.at ?? ""} kept ${r.kept}, removed ${r.removed}, ${usd(r.cost)}`)).join(" · ")}`}
      </span>
    </div>
  );
}
