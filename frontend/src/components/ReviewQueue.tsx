import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleCheck, LoaderCircle, MapPin, Sparkles, Undo2, X, CheckCheck } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import type { Marker, Tender, TenderHouseMarks, ThemePref } from "../lib/types";
import { cx, isApproved } from "../lib/util";
import { PageHeader } from "./Tenders";

interface Item {
  m: Marker;
  h: TenderHouseMarks;
}

type Done = { kind: "approve" | "reject"; item: Item };

export function ReviewQueue({
  id, theme, setTheme, onHome, onBack, onOpenDrawing, initial, threshold, setThreshold,
}: {
  id: string;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  onHome: () => void;
  onBack: () => void;
  onOpenDrawing: (ht: { project_id: string; name: string; filepath: string }, page: number, markerId: string) => void;
  initial?: { project_id?: string; legend_id?: string };
  threshold: number;
  setThreshold: (n: number) => void;
}) {
  const toast = useToast();
  const [tender, setTender] = useState<Tender | null>(null);
  const [houses, setHouses] = useState<TenderHouseMarks[] | null>(null);
  const [samples, setSamples] = useState<Map<string, string>>(new Map());
  const [house, setHouse] = useState(initial?.project_id ?? "");
  const [legend, setLegend] = useState(initial?.legend_id ?? "");
  const [pos, setPos] = useState(0);
  const [history, setHistory] = useState<Done[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  // Decisions sent but not yet saved: applied on top of any refresh so a mark never pops back
  const pending = useRef<Map<string, "approve" | "reject">>(new Map());
  const applyPending = (hs: TenderHouseMarks[]) =>
    pending.current.size
      ? hs.map((h) => ({
          ...h,
          markers: h.markers
            .filter((m) => pending.current.get(m.marker_id) !== "reject")
            .map((m) => (pending.current.get(m.marker_id) === "approve" ? { ...m, status: "user_verified" as const } : m)),
        }))
      : hs;

  useEffect(() => {
    api.tenderMarks(id).then((r) => {
      setTender(r.tender);
      setHouses(r.house_types);
    });
    api.library().then((lib) => {
      const m = new Map<string, string>();
      for (const s of lib) if (s.template_image_b64) m.set((s.legend_id || s.symbol_id) as string, s.template_image_b64);
      setSamples(m);
    });
  }, [id]);

  const live = tender?.status === "running" || !!tender?.ai_progress?.running;
  const curId = useRef<string | null>(null);
  useEffect(() => {
    if (!live) return;
    const h = setInterval(async () => {
      const r = await api.tenderMarks(id).catch(() => null);
      if (!r) return;
      setTender(r.tender);
      setHouses(applyPending(r.house_types));
    }, 5000);
    return () => clearInterval(h);
  }, [live, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = useMemo(() => {
    const m = new Map<string, { label: string; color: string; stage: string; category: string }>();
    for (const h of houses ?? []) for (const l of h.legends) m.set(l.legend_id, { label: l.label, color: l.color, stage: l.fix_stage, category: l.category });
    return m;
  }, [houses]);

  // Queue: everything not yet decided, at or above the threshold, in drawing order
  const queue = useMemo<Item[]>(() => {
    if (!houses) return [];
    const out: Item[] = [];
    for (const h of houses) {
      if (house && h.project_id !== house) continue;
      const pageOrder = new Map(h.electrical_pages.map((p, i) => [p.page_index, i]));
      const ms = h.markers
        .filter((m) => !isApproved(m) && m.confidence_score >= threshold && (!legend || m.legend_id === legend))
        .sort(
          (a, b) =>
            (pageOrder.get(a.page_index) ?? 99) - (pageOrder.get(b.page_index) ?? 99) ||
            (labels.get(a.legend_id)?.label ?? "").localeCompare(labels.get(b.legend_id)?.label ?? "") ||
            Math.round(a.y / 150) - Math.round(b.y / 150) ||
            a.x - b.x,
        );
      for (const m of ms) out.push({ m, h });
    }
    return out;
  }, [houses, house, legend, threshold, labels]);

  const cur = queue[Math.min(pos, queue.length - 1)] as Item | undefined;
  useEffect(() => {
    const id0 = curId.current;
    if (!id0) return;
    const i = queue.findIndex((it) => it.m.marker_id === id0);
    if (i >= 0 && i !== pos) setPos(i);
  }, [queue]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    curId.current = cur?.m.marker_id ?? null;
  }, [cur?.m.marker_id]);
  useEffect(() => {
    if (pos > 0 && pos >= queue.length) setPos(Math.max(0, queue.length - 1));
  }, [queue.length, pos]);

  // Preload the next few crops so the queue feels instant
  useEffect(() => {
    for (const it of queue.slice(pos + 1, pos + 4)) {
      new Image().src = api.cropUrl(it.h.filepath, it.m.page_index, it.m);
      new Image().src = api.cropUrl(it.h.filepath, it.m.page_index, it.m, 9, 300);
    }
  }, [queue, pos]);

  const mutate = (pid: string, fn: (ms: Marker[]) => Marker[]) =>
    setHouses((hs) => hs?.map((h) => (h.project_id === pid ? { ...h, markers: fn(h.markers) } : h)) ?? null);

  const decide = useCallback(
    (kind: "approve" | "reject") => {
      if (!cur) return;
      const { m, h } = cur;
      if (kind === "approve") mutate(h.project_id, (ms) => ms.map((x) => (x.marker_id === m.marker_id ? { ...x, status: "user_verified" } : x)));
      else mutate(h.project_id, (ms) => ms.filter((x) => x.marker_id !== m.marker_id));
      setHistory((hh) => [...hh, { kind, item: cur }]);
      // The decided item leaves the queue, so the same index now points at the next one
      const next = queue[pos + 1] ?? queue[pos - 1];
      curId.current = next ? next.m.marker_id : null;
      pending.current.set(m.marker_id, kind);
      api
        .decide(id, { project_id: h.project_id, marker_id: m.marker_id, action: kind })
        .catch((e) => toast({ tone: "error", title: "Couldn't save that decision", body: (e as Error).message }))
        .finally(() => setTimeout(() => pending.current.delete(m.marker_id), 6000));
    },
    [cur, id, toast, queue, pos],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    const { m, h } = last.item;
    mutate(h.project_id, (ms) => [...ms.filter((x) => x.marker_id !== m.marker_id), m]);
    setHistory((hh) => hh.slice(0, -1));
    api.decide(id, { project_id: h.project_id, marker_id: m.marker_id, action: "restore", marker: m }).catch(() => {});
    // Put the cursor back on the restored item once the queue recomputes
    setTimeout(() => setPos((p) => p), 0);
  }, [history, id]);

  // Keep the cursor on a restored item
  const lastRestored = useRef<string | null>(null);
  useEffect(() => {
    const id0 = lastRestored.current;
    if (!id0) return;
    const i = queue.findIndex((it) => it.m.marker_id === id0);
    if (i >= 0) setPos(i);
    lastRestored.current = null;
  }, [queue]);

  const approveAll = async () => {
    setBusy(true);
    try {
      const ids = queue.map((it) => it.m.marker_id);
      const pids = [...new Set(queue.map((it) => it.h.project_id))];
      const r = await api.approveMany(id, pids, ids);
      const set = new Set(ids);
      setHouses((hs) => hs?.map((h) => ({ ...h, markers: h.markers.map((m) => (set.has(m.marker_id) ? { ...m, status: "user_verified" } : m)) })) ?? null);
      toast({ tone: "success", title: `Approved ${r.approved} marks` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't approve", body: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea") || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "a" || k === "enter") { e.preventDefault(); decide("approve"); }
      else if (k === "x" || k === "delete" || k === "backspace" || k === "d") { e.preventDefault(); decide("reject"); }
      else if (k === "j" || k === "arrowright") { e.preventDefault(); setPos((p) => Math.min(queue.length - 1, p + 1)); }
      else if (k === "k" || k === "arrowleft") { e.preventDefault(); setPos((p) => Math.max(0, p - 1)); }
      else if (k === "z" || k === "u") {
        e.preventDefault();
        const last = history[history.length - 1];
        if (last) lastRestored.current = last.item.m.marker_id;
        undo();
      } else if (k === "escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, undo, queue.length, history, onBack]);

  const approvedN = history.filter((d) => d.kind === "approve").length;
  const deletedN = history.length - approvedN;
  const total = queue.length + history.length;
  const info = cur ? labels.get(cur.m.legend_id) : undefined;
  const page = cur ? cur.h.electrical_pages.find((p) => p.page_index === cur.m.page_index) : undefined;
  const meta = (cur?.m.metadata ?? {}) as { ai_audit_reason?: string; first_pass_score?: number };
  const legendsInView = useMemo(() => {
    const ids = new Set<string>();
    for (const h of houses ?? []) if (!house || h.project_id === house) for (const m of h.markers) if (!isApproved(m) && m.confidence_score >= threshold) ids.add(m.legend_id);
    return [...ids].sort((a, b) => (labels.get(a)?.label ?? "").localeCompare(labels.get(b)?.label ?? ""));
  }, [houses, house, threshold, labels]);

  return (
    <div className="shell">
      <PageHeader theme={theme} setTheme={setTheme} onHome={onHome}>
        <span className="sep">/</span>
        <button className="crumb-btn" onClick={onBack}>{tender?.name ?? "Tender"}</button>
        <span className="sep">/</span>
        <span className="crumb-btn" style={{ cursor: "default" }}><b>Review queue</b></span>
      </PageHeader>

      <main className="page scroll">
        <div className="page-inner queue">
          <div className="queue-bar">
            <button className="btn btn-ghost" onClick={onBack}><ArrowLeft size={14} /> Overview</button>
            <select className="select" style={{ width: 170 }} value={house} onChange={(e) => { setHouse(e.target.value); setPos(0); }} aria-label="House type">
              <option value="">All house types</option>
              {houses?.map((h) => <option key={h.project_id} value={h.project_id}>{h.name}</option>)}
            </select>
            <select className="select" style={{ width: 220 }} value={legend} onChange={(e) => { setLegend(e.target.value); setPos(0); }} aria-label="Symbol">
              <option value="">All symbols</option>
              {legendsInView.map((l) => <option key={l} value={l}>{labels.get(l)?.label ?? l}</option>)}
            </select>
            <div className="row grow" style={{ minWidth: 200 }}>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>Show from</span>
              <input type="range" className="slider" min={0.55} max={0.95} step={0.01} value={threshold}
                onChange={(e) => { setThreshold(Number(e.target.value)); setPos(0); }} aria-label="Minimum score" />
              <b className="mono">{Math.round(threshold * 100)}%</b>
            </div>
          </div>

          {tender?.status === "running" && (
            <div className="queue-live">
              <span className="live-dot" aria-hidden="true" />
              <span className="grow">
                Still counting: {tender.progress?.sheets_done ?? 0} of {tender.progress?.sheets_total ?? "?"} sheets done.
                New marks join this queue automatically as each sheet finishes.
              </span>
            </div>
          )}
          {tender?.ai_progress?.running && (
            <div className="queue-live" style={{ background: "var(--ai-soft)" }}>
              <LoaderCircle size={13} className="spin" style={{ color: "var(--ai)" }} />
              <span className="grow">{tender.ai_progress.message}. Marks it removes disappear from the queue; kept ones show "AI confirmed".</span>
            </div>
          )}
          <div className="queue-progress">
            <div className="stackbar" style={{ height: 8 }}>
              <i style={{ width: `${total ? (approvedN / total) * 100 : 0}%`, background: "var(--ok)" }} />
              <i style={{ width: `${total ? (deletedN / total) * 100 : 0}%`, background: "var(--reject)", opacity: 0.7 }} />
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">
                <b style={{ color: "var(--fg)" }}>{queue.length}</b> left · {approvedN} approved · {deletedN} deleted this session
              </span>
              {queue.length > 0 &&
                (confirmAll ? (
                  <span className="row">
                    <span className="muted">Approve all {queue.length} in this view?</span>
                    <button className="btn btn-ok btn-sm" disabled={busy} onClick={approveAll}>
                      {busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Yes, approve
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmAll(false)}>Cancel</button>
                  </span>
                ) : (
                  <button className="btn btn-quiet btn-sm" onClick={() => setConfirmAll(true)}>
                    <CheckCheck size={14} /> Approve all in view
                  </button>
                ))}
            </div>
          </div>

          {!houses ? (
            <div className="skeleton" style={{ height: 420 }} />
          ) : !cur ? (
            <div className="card empty" style={{ padding: 56 }}>
              {tender?.status === "running" ? <LoaderCircle size={28} className="spin muted" /> : <CircleCheck size={30} style={{ color: "var(--ok)" }} />}
              <h3>{tender?.status === "running" ? "Waiting for the next sheet…" : "All done in this view"}</h3>
              <p>
                Nothing left above {Math.round(threshold * 100)}%
                {house || legend ? " for this filter" : ""}. Lower the slider to check weaker matches, or go back to the overview.
              </p>
              <div className="row">
                {history.length > 0 && <button className="btn btn-ghost" onClick={() => { lastRestored.current = history[history.length - 1].item.m.marker_id; undo(); }}><Undo2 size={14} /> Undo last</button>}
                <button className="btn btn-primary" onClick={onBack}>Back to overview</button>
              </div>
            </div>
          ) : (
            <div className="card review-card">
              <div className="review-head">
                <div>
                  <span className="eyebrow">{cur.h.name} · {page?.title || `p.${cur.m.page_number}`} · {Math.min(pos, queue.length - 1) + 1} of {queue.length}</span>
                  <h2 className="h2" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="swatch" style={{ background: info?.color, width: 12, height: 12 }} />
                    Is this a {info?.label ?? "symbol"}?
                  </h2>
                </div>
                <div className="row">
                  <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{Math.round(cur.m.confidence_score * 100)}%</span>
                  {cur.m.status === "ai_verified" ? (
                    <span className="pill pill-ai">AI confirmed</span>
                  ) : cur.m.confidence_score >= (tender?.settings?.auto_high ?? 0.85) ? (
                    <span className="pill pill-ok">Strong match</span>
                  ) : (
                    <span className="pill pill-review">Borderline</span>
                  )}
                </div>
              </div>

              <div className="compare">
                <figure>
                  <div className="frame sample">
                    {samples.get(cur.m.legend_id) ? <img src={samples.get(cur.m.legend_id)} alt="Library sample" /> : <span className="muted">No sample</span>}
                  </div>
                  <figcaption>Library sample</figcaption>
                </figure>
                <figure>
                  <div className="frame found">
                    <img key={cur.m.marker_id} src={api.cropUrl(cur.h.filepath, cur.m.page_index, cur.m)} alt="Found on drawing" />
                    <span className="target" />
                  </div>
                  <figcaption>Found on the drawing</figcaption>
                </figure>
                <figure>
                  <div className="frame context">
                    <img key={cur.m.marker_id + "c"} src={api.cropUrl(cur.h.filepath, cur.m.page_index, cur.m, 9, 300)} alt="Surroundings" />
                    <span className="target small" />
                  </div>
                  <figcaption>
                    <button className="btn btn-quiet btn-sm" onClick={() => onOpenDrawing(cur.h, cur.m.page_index, cur.m.marker_id)}>
                      <MapPin size={13} /> Open on drawing
                    </button>
                  </figcaption>
                </figure>
              </div>

              {meta.ai_audit_reason && (
                <div className="callout">
                  <Sparkles size={14} style={{ color: "var(--ai)" }} />
                  <span>
                    <b>AI:</b> {meta.ai_audit_reason}
                    {meta.first_pass_score != null && <span className="muted"> · first pass {Math.round(meta.first_pass_score * 100)}%</span>}
                  </span>
                </div>
              )}

              <div className="decide">
                <button className="icon-btn" aria-label="Previous" title="Previous (K)" onClick={() => setPos((p) => Math.max(0, p - 1))}><ChevronLeft size={18} /></button>
                <button className="btn btn-danger btn-xl" onClick={() => decide("reject")}>
                  <X size={18} /> Delete <span className="kbd">X</span>
                </button>
                <button className="btn btn-ok btn-xl" onClick={() => decide("approve")}>
                  <Check size={18} /> Approve <span className="kbd">A</span>
                </button>
                <button className="icon-btn" aria-label="Skip" title="Skip (J)" onClick={() => setPos((p) => Math.min(queue.length - 1, p + 1))}><ChevronRight size={18} /></button>
              </div>
              <div className="row" style={{ justifyContent: "center" }}>
                <button className={cx("btn btn-quiet btn-sm")} disabled={!history.length}
                  onClick={() => { lastRestored.current = history[history.length - 1]?.item.m.marker_id ?? null; undo(); }}>
                  <Undo2 size={13} /> Undo <span className="kbd">Z</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
