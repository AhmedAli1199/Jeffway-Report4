import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CircleHelp, LoaderCircle, RefreshCw, Search, Trash, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/util";
import { usd } from "./Costs";
import { Modal } from "./ui";

export interface AuditSummary {
  id: string;
  timestamp: string;
  legend_label: string;
  model_used?: string;
  candidates: number;
  answered: number;
  kept: number;
  removed: number;
  cost?: number | null;
  tag?: string | null;
  error?: boolean;
}

interface AuditFull {
  id: string;
  timestamp: string;
  legend_label: string;
  model_used?: string;
  template_image_b64?: string;
  template_strip_b64?: string;
  candidates: { marker_id: string; patch_b64: string; index: number; angle?: number; confidence_score?: number; page_index?: number; nearby_codes?: string[] | null }[];
  verifications: { marker_id: string; is_valid: boolean; confidence: number; reason: string; suggested_reclassification?: string }[];
  prompt_text?: string;
  raw_response?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

const src = (b64?: string) => (!b64 ? "" : b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`);

/* ------------------------------------------------------------------ list */

export function AuditList({ tag, compact }: { tag?: string; compact?: boolean }) {
  const [logs, setLogs] = useState<AuditSummary[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = () => {
    setErr("");
    api
      .auditLogs()
      .then((r) => setLogs(r.logs as unknown as AuditSummary[]))
      .catch((e) => setErr((e as Error).message));
  };
  useEffect(load, []);

  const shown = useMemo(
    () => (logs ?? []).filter((l) => (!tag || l.tag === tag) && l.legend_label?.toLowerCase().includes(q.toLowerCase())),
    [logs, tag, q],
  );

  return (
    <div className={cx("audit-list", compact && "compact")}>
      <div className="row">
        <div className="search grow">
          <Search size={14} />
          <input className="input" placeholder="Filter by symbol" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={load}><RefreshCw size={14} /></button>
        {!tag && (
          <button
            className="icon-btn"
            title="Clear log"
            aria-label="Clear log"
            onClick={async () => {
              await api.clearAuditLogs();
              load();
            }}
          >
            <Trash size={14} />
          </button>
        )}
      </div>
      {err && <p className="muted">{err}</p>}
      {!logs && !err && <div className="empty"><LoaderCircle size={18} className="spin" /></div>}
      {logs && shown.length === 0 && (
        <div className="empty">
          <h3>No AI checks yet</h3>
          <p>Each AI call is kept here with the pictures it was sent and what it decided about each one.</p>
        </div>
      )}
      <div className="log">
        {shown.map((l) => (
          <button key={l.id} className="log-item log-btn" onClick={() => setOpen(l.id)}>
            <div className="head">
              <b className="truncate">{l.legend_label}</b>
              <span className="muted mono" style={{ fontSize: 11 }}>{l.timestamp?.slice(5, 16)}</span>
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {l.error ? (
                <span className="pill pill-reject">Call failed</span>
              ) : (
                <>
                  <span className="pill pill-ok">Kept {l.kept}</span>
                  <span className="pill pill-reject">Removed {l.removed}</span>
                  {l.candidates > l.answered && <span className="pill pill-review">No answer {l.candidates - l.answered}</span>}
                </>
              )}
              <span className="muted" style={{ fontSize: 11.5 }}>
                {l.candidates} images · {l.model_used}
                {l.cost != null ? ` · ${usd(l.cost, 3)}` : ""}
              </span>
            </div>
            <span className="log-open">Inspect images and reasons →</span>
          </button>
        ))}
      </div>
      {open && <AuditDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

type Show = "all" | "kept" | "removed" | "none";

export function AuditDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [log, setLog] = useState<AuditFull | null>(null);
  const [err, setErr] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [showPrompt, setShowPrompt] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    api.auditLog(id).then((l) => setLog(l as unknown as AuditFull)).catch((e) => setErr((e as Error).message));
  }, [id]);

  const rows = useMemo(() => {
    if (!log) return [];
    const byId = new Map(log.verifications.map((v) => [v.marker_id, v]));
    return log.candidates.map((c) => ({ c, v: byId.get(c.marker_id) }));
  }, [log]);
  const kept = rows.filter((r) => r.v?.is_valid).length;
  const removed = rows.filter((r) => r.v && !r.v.is_valid).length;
  const none = rows.length - kept - removed;
  const shown = rows.filter((r) =>
    show === "all" ? true : show === "kept" ? r.v?.is_valid : show === "removed" ? r.v && !r.v.is_valid : !r.v,
  );

  const pretty = (s?: string) => {
    try {
      return JSON.stringify(JSON.parse(s ?? ""), null, 2);
    } catch {
      return s ?? "";
    }
  };

  return (
    <Modal
      wide
      className="audit-modal"
      title={log ? `AI check · ${log.legend_label}` : "AI check"}
      subtitle={
        log
          ? `${log.timestamp} · ${log.model_used ?? ""}${log.usage?.input_tokens ? ` · ${log.usage.input_tokens.toLocaleString()} tokens in, ${log.usage.output_tokens?.toLocaleString()} out` : ""}${log.usage?.cost != null ? ` · ${usd(log.usage.cost, 4)}` : ""}`
          : undefined
      }
      onClose={onClose}
    >
      {err && <div className="callout" style={{ color: "var(--reject)" }}><TriangleAlert size={14} /> {err}</div>}
      {!log && !err && <div className="skeleton" style={{ height: 240 }} />}
      {log && (
        <>
          <section className="audit-ref">
            <span className="eyebrow">Sent to the AI as the reference</span>
            <div className="ref-row">
              <figure>
                <div className="ref-frame">
                  {log.template_image_b64 ? <img src={src(log.template_image_b64)} alt="Reference sample" /> : <span className="muted">Not recorded</span>}
                </div>
                <figcaption>Image 1 · the symbol sample</figcaption>
              </figure>
              <figure className="grow">
                <div className="ref-frame strip">
                  {log.template_strip_b64 ? (
                    <img src={src(log.template_strip_b64)} alt="Sample at four rotations" />
                  ) : (
                    <span className="muted">Rotation guide not recorded for calls made before this update</span>
                  )}
                </div>
                <figcaption>Image 2 · the same symbol at 0°, 90°, 180° and 270°</figcaption>
              </figure>
            </div>
          </section>

          <section className="stack" style={{ gap: 10 }}>
            <div className="section-head">
              <span className="eyebrow">{rows.length} candidate images and the AI's verdict on each</span>
              <div className="seg" role="group">
                <button aria-pressed={show === "all"} onClick={() => setShow("all")}>All <span className="n">{rows.length}</span></button>
                <button aria-pressed={show === "kept"} onClick={() => setShow("kept")}>Kept <span className="n">{kept}</span></button>
                <button aria-pressed={show === "removed"} onClick={() => setShow("removed")}>Removed <span className="n">{removed}</span></button>
                {none > 0 && <button aria-pressed={show === "none"} onClick={() => setShow("none")}>No answer <span className="n">{none}</span></button>}
              </div>
            </div>
            <div className="cand-grid">
              {shown.map(({ c, v }) => {
                const state = !v ? "none" : v.is_valid ? "kept" : "removed";
                return (
                  <div key={c.marker_id} className={cx("cand", state)}>
                    <div className="cand-img">
                      <img src={src(c.patch_b64)} alt={`Candidate ${c.index}`} />
                      <span className="cand-no">#{c.index}</span>
                      <span className={cx("cand-verdict", state)}>
                        {state === "kept" ? "Kept" : state === "removed" ? "Removed" : "No answer"}
                        {v ? ` · ${Math.round(v.confidence * 100)}%` : ""}
                      </span>
                    </div>
                    <div className="cand-body">
                      <div className="cand-meta mono">
                        {c.confidence_score != null && <span>first pass {Math.round(c.confidence_score * 100)}%</span>}
                        {c.angle != null && <span>{c.angle}°</span>}
                        {c.page_index != null && <span>p.{c.page_index + 1}</span>}
                        {c.nearby_codes != null && <span title="Code text beside it, read from the CAD file">{c.nearby_codes.length ? `code: ${c.nearby_codes.join(", ")}` : "no code"}</span>}
                      </div>
                      {v ? (
                        <p>{v.reason}</p>
                      ) : (
                        <p className="muted">
                          <CircleHelp size={12} /> The AI didn't return a verdict for this image, so the mark was left for a person.
                        </p>
                      )}
                      {v?.suggested_reclassification && (
                        <p className="suggest">Looks more like: <b>{v.suggested_reclassification}</b></p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="stack" style={{ gap: 6 }}>
            <button className="btn btn-quiet btn-sm" style={{ justifySelf: "start" }} onClick={() => setShowPrompt(!showPrompt)}>
              {showPrompt ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Instructions sent to the AI
            </button>
            {showPrompt && <pre className="code-block">{log.prompt_text}</pre>}
            <button className="btn btn-quiet btn-sm" style={{ justifySelf: "start" }} onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />} The AI's raw answer
            </button>
            {showRaw && <pre className="code-block">{pretty(log.raw_response)}</pre>}
          </section>
        </>
      )}
    </Modal>
  );
}
