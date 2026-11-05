import { useMemo, useState } from "react";
import { CircleCheck, KeyRound, LoaderCircle, Plus, Search, Sparkles, TriangleAlert, Crop } from "lucide-react";
import type { CropIntent, Takeoff } from "../state/useTakeoff";
import type { CanvasMode, LegendItem, LibrarySymbol, Marker, Rect, ThemePref, Verification } from "../lib/types";
import { CATEGORIES, FIX_STAGES, SYMBOL_COLORS, isApproved, isOpen } from "../lib/util";
import { API_BASE } from "../lib/api";
import { Modal, SymbolSample } from "./ui";

/* ---------------- New / re-cropped symbol ---------------- */

export function SymbolModal({ t, intent }: { t: Takeoff; intent: CropIntent }) {
  const base = intent.legend;
  const [form, setForm] = useState<LegendItem>(() => ({
    legend_id: base?.legend_id ?? `leg_${Date.now()}`,
    label: base?.label ?? "",
    color: base?.color ?? SYMBOL_COLORS[t.legends.length % SYMBOL_COLORS.length],
    category: base?.category ?? "Power & Accessories",
    fix_stage: base?.fix_stage ?? "2nd Fix",
    manufacturer: base?.manufacturer ?? "Deta",
    part_code: base?.part_code ?? "",
    count: base?.count,
  }));
  const set = (patch: Partial<LegendItem>) => setForm((f) => ({ ...f, ...patch }));
  const final = (): LegendItem => ({ ...form, label: form.label.trim(), template_crop_coords: intent.rect, template_image_b64: intent.image });
  const valid = form.label.trim().length > 0;

  return (
    <Modal
      title={base ? `New sample for ${base.label}` : "New symbol"}
      subtitle="Plotline looks for shapes like this sample across the sheet, at every rotation."
      onClose={() => { t.setCropIntent(null); t.setCropTarget(null); }}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => { t.setCropIntent(null); t.startCrop(base); }}>
            <Crop size={14} /> Crop again
          </button>
          <span className="grow" />
          <button className="btn btn-ghost" disabled={!valid} onClick={() => t.saveSymbol(final(), false)}>
            Save only
          </button>
          <button className="btn btn-copper" disabled={!valid} onClick={() => t.saveSymbol(final(), true)}>
            Save and count
          </button>
        </>
      }
    >
      <div className="crop-preview">
        {intent.image ? <img src={intent.image} alt="Cropped sample" /> : <span className="muted">Preview unavailable</span>}
      </div>
      <p className="muted mono" style={{ margin: "-6px 0 0", fontSize: 11.5, textAlign: "center" }}>
        {intent.rect.width} × {intent.rect.height} px at ({intent.rect.x}, {intent.rect.y})
      </p>
      <form
        className="grid2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) t.saveSymbol(final(), true);
        }}
      >
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="sym-label">Name, as on the legend</label>
          <input id="sym-label" className="input" value={form.label} placeholder="e.g. Twin switched socket" onChange={(e) => set({ label: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="sym-cat">Category</label>
          <select id="sym-cat" className="select" value={form.category} onChange={(e) => set({ category: e.target.value })}>
            {[...new Set([form.category, ...CATEGORIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sym-stage">Fix stage</label>
          <select id="sym-stage" className="select" value={form.fix_stage} onChange={(e) => set({ fix_stage: e.target.value as LegendItem["fix_stage"] })}>
            {FIX_STAGES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sym-man">Manufacturer</label>
          <input id="sym-man" className="input" value={form.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="sym-part">Part code</label>
          <input id="sym-part" className="input" value={form.part_code} onChange={(e) => set({ part_code: e.target.value })} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Mark colour</label>
          <div className="color-row">
            {SYMBOL_COLORS.map((c) => (
              <button type="button" key={c} style={{ background: c }} aria-label={c} aria-pressed={form.color === c} onClick={() => set({ color: c })} />
            ))}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ---------------- AI check ---------------- */

type Scope = "open" | "weak" | "all";

export function AICheckModal({ t, onClose, onNeedKey }: { t: Takeoff; onClose: () => void; onNeedKey: () => void }) {
  const [legendId, setLegendId] = useState<string>(t.selectedLegendId ?? "");
  const [scope, setScope] = useState<Scope>("open");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Verification[] | null>(null);

  const candidatesFor = (id: string) => t.visibleMarkers.filter((m) => m.legend_id === id && !isApproved(m));
  const legendsWithWork = t.legends.filter((l) => candidatesFor(l.legend_id).length > 0);
  const legend = t.legends.find((l) => l.legend_id === legendId) ?? legendsWithWork[0] ?? null;

  const targets: Marker[] = useMemo(() => {
    if (!legend) return [];
    const all = candidatesFor(legend.legend_id);
    if (scope === "open") return all.filter(isOpen);
    if (scope === "weak") return all.filter((m) => m.confidence_score < 0.8);
    return all;
  }, [legend, scope, t.visibleMarkers]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!legend) return;
    setRunning(true);
    setError("");
    try {
      const r = await t.runAICheck(legend, targets);
      if (!r.length) setError("The AI returned no decisions. Try again, or check the backend log.");
      setResults(r);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      if (/api key/i.test(msg) && !t.apiKey) onNeedKey();
    } finally {
      setRunning(false);
    }
  };

  const kept = results?.filter((r) => r.is_valid).length ?? 0;

  return (
    <Modal
      title="Ask AI to check marks"
      subtitle="GPT-4o looks at each mark next to your sample and keeps or removes it, with a reason."
      onClose={onClose}
      footer={
        results ? (
          <>
            <span className="muted grow">
              Keeps {kept}, removes {results.length - kept}
            </span>
            <button className="btn btn-ghost" onClick={() => setResults(null)}>Back</button>
            <button className="btn btn-ghost" onClick={() => { t.applyAICheck(results, false); onClose(); }}>
              Apply as AI-checked
            </button>
            <button className="btn btn-copper" onClick={() => { t.applyAICheck(results, true); onClose(); }}>
              Apply and approve
            </button>
          </>
        ) : (
          <>
            {!t.apiKey && (
              <span className="muted grow" style={{ fontSize: 12 }}>
                Uses the server's key unless you add your own in Settings.
              </span>
            )}
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-copper" disabled={!legend || targets.length === 0 || running} onClick={run}>
              {running ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
              {running ? "Checking…" : `Check ${targets.length} mark${targets.length === 1 ? "" : "s"}`}
            </button>
          </>
        )
      }
    >
      {!results && (
        <>
          {legendsWithWork.length === 0 ? (
            <div className="empty">
              <CircleCheck size={22} />
              <h3>Nothing to check</h3>
              <p>Every mark on this sheet is already approved.</p>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="ai-sym">Symbol</label>
                <select id="ai-sym" className="select" value={legend?.legend_id} onChange={(e) => setLegendId(e.target.value)}>
                  {legendsWithWork.map((l) => (
                    <option key={l.legend_id} value={l.legend_id}>
                      {l.label} ({candidatesFor(l.legend_id).length})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Which marks</label>
                <div className="seg" role="group">
                  <button type="button" aria-pressed={scope === "open"} onClick={() => setScope("open")}>To review</button>
                  <button type="button" aria-pressed={scope === "weak"} onClick={() => setScope("weak")}>Below 80%</button>
                  <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All unapproved</button>
                </div>
              </div>
            </>
          )}
          {error && (
            <div className="callout" style={{ color: "var(--reject)" }}>
              <TriangleAlert size={14} /> {error}
            </div>
          )}
        </>
      )}
      {results && (
        <div className="log" style={{ padding: 0 }}>
          {results.map((r) => (
            <div key={r.marker_id} className="log-item">
              <div className="head">
                <span className={`pill ${r.is_valid ? "pill-ok" : "pill-reject"}`}>{r.is_valid ? "Keep" : "Remove"}</span>
                <span className="mono muted">{Math.round(r.confidence * 100)}%</span>
              </div>
              <p>{r.reason}</p>
              {r.suggested_reclassification && <p className="muted">Looks more like: {r.suggested_reclassification}</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Settings ---------------- */

export function SettingsModal({
  t, onClose, theme, setTheme, mode, setMode,
}: {
  t: Takeoff;
  onClose: () => void;
  theme: ThemePref;
  setTheme: (x: ThemePref) => void;
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
}) {
  const [key, setKey] = useState(t.apiKey);
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { t.setApiKey(key.trim()); onClose(); }}>Save</button>
        </>
      }
    >
      <div className="field">
        <label>Appearance</label>
        <div className="seg" role="group">
          {(["system", "light", "dark"] as ThemePref[]).map((x) => (
            <button key={x} type="button" aria-pressed={theme === x} onClick={() => setTheme(x)} style={{ textTransform: "capitalize" }}>
              {x}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Drawing</label>
        <div className="seg" role="group">
          <button type="button" aria-pressed={mode === "paper"} onClick={() => setMode("paper")}>Paper</button>
          <button type="button" aria-pressed={mode === "blueprint"} onClick={() => setMode("blueprint")}>Blueprint</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="key">OpenAI API key</label>
        <div className="search">
          <KeyRound size={14} />
          <input id="key" className="input" type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <span className="hint">
          Used for AI checks, reading legends and detecting rooms. Stored only in this browser. Leave blank to use the
          key in the backend's .env file.
        </span>
      </div>
      <div className="field">
        <label>Takeoff engine</label>
        <span className="mono muted" style={{ fontSize: 12 }}>{API_BASE}</span>
      </div>
    </Modal>
  );
}

/* ---------------- Symbol library ---------------- */

export function LibraryModal({ t, onClose }: { t: Takeoff; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<LibrarySymbol[]>(t.library);
  const [dirty, setDirty] = useState(false);
  const inProject = new Set(t.legends.map((l) => l.legend_id));
  const list = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => `${r.cad_label} ${r.sheet_desc} ${r.category}`.toLowerCase().includes(q.toLowerCase()));

  const edit = (i: number, patch: Partial<LibrarySymbol>) => {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  return (
    <Modal
      wide
      title="Symbol library"
      subtitle="Jeffway's master list. Each row maps a drawing symbol to a Second Fix line, a price and its cable allowance."
      onClose={onClose}
      footer={
        <>
          <span className="muted grow">{rows.length} symbols</span>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!dirty} onClick={async () => { await t.saveLibrary(rows); setDirty(false); }}>
            Save changes
          </button>
        </>
      }
    >
      <div className="search">
        <Search size={14} />
        <input className="input" placeholder="Search symbols" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ overflowX: "auto", margin: "0 -20px" }}>
        <table className="boq" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Sheet line</th>
              <th>£ / unit</th>
              <th>Cable m / point</th>
              <th>Cable type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map(({ r, i }) => {
              const id = r.legend_id || r.symbol_id || "";
              const legendLike: LegendItem = {
                legend_id: id, label: r.cad_label ?? "", color: r.color ?? "var(--line-strong)", category: "",
                fix_stage: "2nd Fix", manufacturer: "", part_code: "", template_image_b64: r.template_image_b64,
              };
              return (
                <tr key={id || i}>
                  <td>
                    <span className="label" style={{ maxWidth: 240 }}>
                      <SymbolSample legend={legendLike} size={26} />
                      <span title={r.cad_label}>{r.cad_label}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: "left" }}>
                    <span className="truncate" style={{ display: "inline-block", maxWidth: 200 }} title={r.sheet_desc}>{r.sheet_desc}</span>
                  </td>
                  <td>
                    <input className="input mono" style={{ width: 80, height: 26, textAlign: "right" }} type="number" step="0.01"
                      value={r.unit_price ?? ""} onChange={(e) => edit(i, { unit_price: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="input mono" style={{ width: 70, height: 26, textAlign: "right" }} type="number" step="0.5"
                      value={r.cable_per_point_m ?? ""} onChange={(e) => edit(i, { cable_per_point_m: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  </td>
                  <td>
                    <input className="input" style={{ width: 150, height: 26 }} value={r.cable_type ?? ""} onChange={(e) => edit(i, { cable_type: e.target.value })} />
                  </td>
                  <td>
                    {inProject.has(id) ? (
                      <span className="pill pill-plain">In project</span>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => t.addFromLibrary(r)}>
                        <Plus size={13} /> Add
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ---------------- Room name ---------------- */

export function RoomModal({ rect, onSave, onClose }: { rect: Rect; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const presets = ["Kitchen", "Lounge", "Dining", "Hall", "WC", "Utility", "Bed 1", "Bed 2", "Bed 3", "Bathroom", "En-suite", "Landing", "Garage"];
  return (
    <Modal
      title="Name this room"
      subtitle={`${Math.round(rect.width)} × ${Math.round(rect.height)} px`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Add room</button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }} className="field">
        <label htmlFor="room-name">Room</label>
        <input id="room-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kitchen" />
      </form>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {presets.map((p) => (
          <button key={p} className="btn btn-ghost btn-sm" onClick={() => onSave(p)}>{p}</button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------------- Shortcuts ---------------- */

const SHORTCUTS: [string, string[]][] = [
  ["Approve mark", ["A"]],
  ["Reject mark", ["X"]],
  ["Next mark", ["J"]],
  ["Previous mark", ["K"]],
  ["Command bar", ["⌘", "K"]],
  ["Save now", ["⌘", "S"]],
  ["Select & pan", ["V"]],
  ["Place a mark", ["M"]],
  ["Crop a sample", ["C"]],
  ["Exclude an area", ["E"]],
  ["Draw a room", ["R"]],
  ["Count selected symbol", ["⇧", "C"]],
  ["Left panel", ["["]],
  ["Right panel", ["]"]],
  ["Focus mode", ["F"]],
  ["Blueprint view", ["B"]],
  ["Zoom in / out", ["+", "−"]],
  ["Fit sheet", ["0"]],
  ["Next / previous sheet", ["⇧", "J / K"]],
  ["Cancel tool", ["Esc"]],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal wide title="Keyboard shortcuts" subtitle="Plotline is built to review a whole sheet without touching the mouse." onClose={onClose}>
      <div className="shortcut-grid">
        {SHORTCUTS.map(([label, keys]) => (
          <div key={label}>
            <span>{label}</span>
            <span className="keys">{keys.map((k) => <span key={k} className="kbd">{k}</span>)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
