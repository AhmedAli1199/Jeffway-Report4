import { useRef } from "react";
import {
  ChevronDown, Command, Download, FileSpreadsheet, FileText, FolderOpen, Keyboard, Monitor, Moon, PanelLeft,
  PanelRight, Settings, Sun, Upload, BookOpen, Check, Focus,
} from "lucide-react";
import type { Takeoff } from "../state/useTakeoff";
import type { ThemePref } from "../lib/types";
import { cx, timeAgo } from "../lib/util";
import { MenuButton } from "./ui";
import { CostPill } from "./Costs";

export type Stage = "pack" | "legend" | "count" | "review" | "plots" | "workbook";

interface Props {
  t: Takeoff;
  leftOpen: boolean;
  rightOpen: boolean;
  focus: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleFocus: () => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  onPalette: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onLibrary: () => void;
  onStage: (s: Stage) => void;
  exportOpen: boolean;
  setExportOpen: (o: boolean) => void;
  onHome: () => void;
  backLabel: string;
}

export function AppBar(p: Props) {
  const { t } = p;
  const file = useRef<HTMLInputElement>(null);

  const anyTemplate = t.legends.some((l) => l.template_image_b64 || l.template_crop_coords);
  const anyMarks = t.markers.length > 0;
  const open = t.sheetStats.open;
  const stages: { id: Stage; label: string; done: boolean }[] = [
    { id: "pack", label: "Pack", done: !!t.project },
    { id: "legend", label: "Legend", done: anyTemplate },
    { id: "count", label: "Count", done: anyMarks },
    { id: "review", label: "Review", done: anyMarks && open === 0 },
    { id: "plots", label: "Plots", done: t.plots > 1 },
    { id: "workbook", label: "Workbook", done: t.exported },
  ];
  const current = stages.find((s) => !s.done)?.id;

  const ThemeIcon = p.theme === "dark" ? Moon : p.theme === "light" ? Sun : Monitor;
  const nextTheme: ThemePref = p.theme === "system" ? "light" : p.theme === "light" ? "dark" : "system";

  return (
    <header className="appbar">
      <button
        className="icon-btn"
        aria-label="Toggle left panel"
        title="Left panel  ([)"
        aria-pressed={p.leftOpen}
        onClick={p.onToggleLeft}
      >
        <PanelLeft size={17} />
      </button>
      <button className="brand brand-btn" onClick={p.onHome} title={p.backLabel}>
        <span className="brand-mark" aria-hidden="true" />
        Plotline
      </button>

      <nav className="crumbs" aria-label="Location">
        <span className="sep">/</span>
        <MenuButton
          label="Switch project"
          className="crumb-btn"
          trigger={
            <>
              <span className="truncate" style={{ maxWidth: 220 }}>{t.project?.name ?? "No project"}</span>
              <ChevronDown size={13} />
            </>
          }
        >
          {(close) => (
            <>
              <div className="label eyebrow">Tender packs</div>
              {t.projects.map((pr) => (
                <button
                  key={pr.project_id}
                  className={cx("menu-item", pr.project_id === t.project?.project_id && "active")}
                  onClick={() => {
                    close();
                    if (pr.project_id !== t.project?.project_id) t.openProject(pr);
                  }}
                >
                  <FolderOpen size={15} />
                  <span className="meta">
                    {pr.name}
                    <small>{pr.filename}</small>
                  </span>
                  {pr.project_id === t.project?.project_id && <Check size={14} />}
                </button>
              ))}
              <hr />
              <button className="menu-item" onClick={() => { close(); file.current?.click(); }}>
                <Upload size={15} />
                <span className="meta">Upload a tender PDF…</span>
              </button>
            </>
          )}
        </MenuButton>
        {t.page && (
          <>
            <span className="sep">/</span>
            <span className="crumb-btn" style={{ cursor: "default" }}>
              <b className="truncate" style={{ maxWidth: 260 }}>{t.pageLabel}</b>
              <span className="mono muted">p.{t.page.page_number}</span>
            </span>
          </>
        )}
      </nav>
      <input
        ref={file}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) t.uploadPdf(f);
          e.target.value = "";
        }}
      />

      <div className="stepper" aria-label="Takeoff stages">
        {stages.map((s, i) => (
          <div key={s.id} className="row" style={{ gap: 2 }}>
            {i > 0 && <span className="line" />}
            <button
              className={cx(s.done && "done", s.id === current && "current")}
              onClick={() => p.onStage(s.id)}
              title={stageHelp[s.id]}
            >
              <span className="dot" />
              <span className="label-text">{s.label}</span>
            </button>
          </div>
        ))}
      </div>

      <span className={cx("save-state", t.save)} title="Changes save automatically">
        <span className="dot" />
        <span>
          {t.save === "saving" ? "Saving…" : t.save === "dirty" ? "Unsaved changes" : t.save === "error" ? "Not saved" : timeAgo(t.savedAt)}
        </span>
      </span>

      <CostPill />
      <button className="btn btn-ghost btn-sm" onClick={p.onPalette} title="Search actions, sheets and symbols">
        <Command size={13} /> <span className="kbd">K</span>
      </button>
      <button className="icon-btn" aria-label="Focus mode" title="Focus on the drawing  (F)" aria-pressed={p.focus} onClick={p.onToggleFocus}>
        <Focus size={16} />
      </button>
      <button
        className="icon-btn"
        aria-label={`Theme: ${p.theme}. Switch to ${nextTheme}`}
        title={`Theme: ${p.theme}`}
        onClick={() => p.setTheme(nextTheme)}
      >
        <ThemeIcon size={16} />
      </button>
      <MenuButton label="More" className="icon-btn" align="right" trigger={<Settings size={16} />}>
        {(close) => (
          <>
            <button className="menu-item" onClick={() => { close(); p.onSettings(); }}>
              <Settings size={15} /> <span className="meta">Settings</span>
            </button>
            <button className="menu-item" onClick={() => { close(); p.onLibrary(); }}>
              <BookOpen size={15} /> <span className="meta">Symbol library</span>
            </button>
            <button className="menu-item" onClick={() => { close(); p.onShortcuts(); }}>
              <Keyboard size={15} /> <span className="meta">Keyboard shortcuts</span> <span className="kbd">?</span>
            </button>
          </>
        )}
      </MenuButton>
      <span className="vsep" />
      <MenuButton
        label="Export"
        className="btn btn-copper"
        align="right"
        open={p.exportOpen}
        onOpenChange={p.setExportOpen}
        trigger={
          <>
            <Download size={14} /> Export
          </>
        }
      >
        {(close) => (
          <>
            <div className="label eyebrow">Counted marks only</div>
            <button className="menu-item" onClick={() => { close(); t.exportAs("tender"); }}>
              <FileSpreadsheet size={15} />
              <span className="meta">Master tender workbook<small>Fills the house-type and Second Fix tabs</small></span>
            </button>
            <button className="menu-item" onClick={() => { close(); t.exportAs("takeoff"); }}>
              <FileSpreadsheet size={15} />
              <span className="meta">Takeoff schedule<small>Room-by-room quantities, 3 tabs</small></span>
            </button>
            <button className="menu-item" onClick={() => { close(); t.exportAs("pdf"); }}>
              <FileText size={15} />
              <span className="meta">Marked-up PDF<small>Every mark drawn on the sheets</small></span>
            </button>
          </>
        )}
      </MenuButton>
      <button
        className="icon-btn"
        aria-label="Toggle right panel"
        title="Right panel  (])"
        aria-pressed={p.rightOpen}
        onClick={p.onToggleRight}
      >
        <PanelRight size={17} />
      </button>
    </header>
  );
}

const stageHelp: Record<Stage, string> = {
  pack: "Choose a sheet from the tender pack",
  legend: "Give each symbol a sample crop",
  count: "Count every symbol on this sheet",
  review: "Approve or reject each mark",
  plots: "Set how many plots use this house type",
  workbook: "Export to the tender workbook",
};
