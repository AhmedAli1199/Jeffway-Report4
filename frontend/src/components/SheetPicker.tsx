import { useMemo, useState } from "react";
import { Check, Expand, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import type { SheetInfo, Tender } from "../lib/types";
import { cx } from "../lib/util";
import { Modal } from "./ui";

const VERDICT = {
  yes: { label: "Electrical", cls: "pill-ok" },
  maybe: { label: "Check", cls: "pill-review" },
  no: { label: "Not electrical", cls: "pill-plain" },
} as const;

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
  const [preview, setPreview] = useState<SheetInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const shown = useMemo(
    () => (view === "all" ? sheets : sheets.filter((s) => s.verdict !== "no" || pick.has(s.page_index))),
    [sheets, view, pick],
  );
  const counts = {
    yes: sheets.filter((s) => s.verdict === "yes").length,
    maybe: sheets.filter((s) => s.verdict === "maybe").length,
  };
  const toggle = (i: number) =>
    setPick((p) => {
      const n = new Set(p);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const save = async () => {
    setSaving(true);
    try {
      const t = await api.setSheets(tenderId, relPath, [...pick]);
      onSaved(t);
      toast({
        tone: "success",
        title: pick.size ? `${pick.size} sheet${pick.size === 1 ? "" : "s"} will be counted` : "Removed from house types",
        body: relPath.split("/").pop(),
      });
      onClose();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      wide
      className="sheet-modal"
      title={relPath.split("/").pop()?.replace(/\.pdf$/i, "") ?? "Sheets"}
      subtitle={`${sheets.length} pages · ${counts.yes} look electrical · ${counts.maybe} to check. Only ticked sheets are counted.`}
      onClose={onClose}
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
        <div className="seg" role="group">
          <button aria-pressed={view === "suggested"} onClick={() => setView("suggested")}>
            Likely electrical <span className="n">{counts.yes + counts.maybe}</span>
          </button>
          <button aria-pressed={view === "all"} onClick={() => setView("all")}>
            All pages <span className="n">{sheets.length}</span>
          </button>
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
            Sheets marked <b>Check</b> mention a few electrical items but don't carry the legend, such as bathroom or kitchen
            elevations. They're left out by default because counting them as well as the floor plan would double-count.
          </span>
        </div>
      )}
      <div className="sheet-grid">
        {shown.map((s) => {
          const on = pick.has(s.page_index);
          const v = VERDICT[s.verdict];
          return (
            <div key={s.page_index} className={cx("sheet-card", on && "on", s.verdict)}>
              <button className="sheet-thumb" onClick={() => toggle(s.page_index)} aria-pressed={on} title={on ? "Click to leave out" : "Click to count this sheet"}>
                <img loading="lazy" src={api.thumbnailUrl(filepath, s.page_index)} alt="" />
                <span className={cx("sheet-check", on && "on")}>{on ? <Check size={14} /> : null}</span>
              </button>
              <div className="sheet-info">
                <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                  <b className="truncate" title={s.title}>{s.title || `Page ${s.page_number}`}</b>
                  <button className="icon-btn icon-btn-sm" title="Preview" aria-label="Preview" onClick={() => setPreview(s)}><Expand size={13} /></button>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <span className={cx("pill", v.cls)}>{v.label}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>p.{s.page_number}</span>
                </div>
                <ul className="reasons">
                  {s.reasons.slice(1).map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
      {preview && (
        <div className="lightbox" onClick={() => setPreview(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{preview.title || `Page ${preview.page_number}`} · p.{preview.page_number}</b>
              <div className="row">
                <button className={cx("btn btn-sm", pick.has(preview.page_index) ? "btn-ghost" : "btn-ok")} onClick={() => toggle(preview.page_index)}>
                  {pick.has(preview.page_index) ? <><X size={13} /> Leave out</> : <><Check size={13} /> Count this sheet</>}
                </button>
                <button className="icon-btn" aria-label="Close preview" onClick={() => setPreview(null)}><X size={16} /></button>
              </div>
            </div>
            <div className="lightbox-img">
              <img src={api.pagePreviewUrl(filepath, preview.page_index)} alt="" />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
