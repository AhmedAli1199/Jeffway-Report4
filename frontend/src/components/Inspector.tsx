import { useMemo } from "react";
import { Cable, CheckCheck, Info, Minus, Plus, Sparkles } from "lucide-react";
import type { Takeoff } from "../state/useTakeoff";
import type { LegendItem } from "../lib/types";
import { FIX_STAGES } from "../lib/util";
import { AuditList } from "./AuditLog";

export type RightTab = "quantities" | "plots" | "ai";

interface Props {
  t: Takeoff;
  tab: RightTab;
  setTab: (t: RightTab) => void;
  onAICheck: () => void;
}

export function Inspector({ t, tab, setTab, onAICheck }: Props) {
  return (
    <div className="panel-inner">
      <div className="tabs" role="tablist">
        <button role="tab" className="tab" aria-selected={tab === "quantities"} onClick={() => setTab("quantities")}>
          Quantities
        </button>
        <button role="tab" className="tab" aria-selected={tab === "plots"} onClick={() => setTab("plots")}>
          Plots &amp; cable
        </button>
        <button role="tab" className="tab" aria-selected={tab === "ai"} onClick={() => setTab("ai")}>
          AI log
        </button>
      </div>
      {tab === "quantities" && <Quantities t={t} onAICheck={onAICheck} />}
      {tab === "plots" && <Plots t={t} />}
      {tab === "ai" && (
        <div className="scroll grow" style={{ padding: "10px 14px" }}>
          <AuditList compact />
        </div>
      )}
    </div>
  );
}

function Quantities({ t, onAICheck }: { t: Takeoff; onAICheck: () => void }) {
  const rows = useMemo(() => {
    const byStage = new Map<string, LegendItem[]>();
    for (const l of t.legends) {
      const c = t.counts.get(l.legend_id);
      if (!c || c.total === 0) continue;
      byStage.set(l.fix_stage, [...(byStage.get(l.fix_stage) ?? []), l]);
    }
    return FIX_STAGES.filter((s) => byStage.has(s)).map((s) => [s, byStage.get(s)!] as const);
  }, [t.legends, t.counts]);

  const totals = useMemo(() => {
    let sheet = 0, house = 0;
    for (const c of t.counts.values()) {
      sheet += c.sheet;
      house += c.total;
    }
    return { sheet, house };
  }, [t.counts]);

  const s = t.sheetStats;
  const pct = (n: number) => (s.total ? `${(n / s.total) * 100}%` : "0%");

  return (
    <>
      <div className="section">
        <div className="section-head">
          <span className="eyebrow">Show marks above</span>
          <span className="mono" style={{ fontWeight: 500 }}>{Math.round(t.threshold * 100)}% match</span>
        </div>
        <input
          type="range"
          className="slider"
          min={0.3}
          max={0.95}
          step={0.01}
          value={t.threshold}
          onChange={(e) => t.setThreshold(Number(e.target.value))}
          aria-label="Minimum match confidence"
        />
      </div>

      <div className="scroll grow">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>Nothing counted yet</h3>
            <p>Pick a symbol on the left and press Count, or count every symbol on this sheet at once.</p>
          </div>
        ) : (
          <table className="boq fixed">
            <colgroup>
              <col />
              <col className="n" />
              <col className="n" />
              <col className="n" style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Item</th>
                <th title="On this sheet">Sheet</th>
                <th title="All sheets in this house type">House</th>
                <th title={`House type × ${t.plots} plots`}>× {t.plots}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([stage, items]) => (
                <FragmentRows key={stage} stage={stage} items={items} t={t} />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total points</td>
                <td className="num">{totals.sheet}</td>
                <td className="num">{totals.house}</td>
                <td className="num">{totals.house * t.plots}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="progress-card">
        <div className="section-head">
          <span className="eyebrow">Review on this sheet</span>
          <span className="mono">
            {s.approved + s.ai} / {s.total}
          </span>
        </div>
        <div className="stackbar" aria-hidden="true">
          <i style={{ width: pct(s.approved), background: "var(--ok)" }} />
          <i style={{ width: pct(s.ai), background: "var(--ai)" }} />
          <i style={{ width: pct(s.open), background: "var(--review)", opacity: 0.55 }} />
        </div>
        <div className="legend-row">
          <span><i style={{ background: "var(--ok)" }} />Approved {s.approved}</span>
          <span><i style={{ background: "var(--ai)" }} />AI-checked {s.ai}</span>
          <span><i style={{ background: "var(--review)" }} />To review {s.open}</span>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-ghost btn-sm" onClick={t.approveHighConfidence} title="Approve unreviewed marks scoring 82% or more">
            <CheckCheck size={14} /> Approve strong matches
          </button>
          {s.ai > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={t.approveAIChecked}>
              <CheckCheck size={14} /> Approve AI-checked
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onAICheck}>
            <Sparkles size={14} /> AI check…
          </button>
        </div>
      </div>
    </>
  );
}

function FragmentRows({ stage, items, t }: { stage: string; items: LegendItem[]; t: Takeoff }) {
  return (
    <>
      <tr className="stage-row">
        <td colSpan={4}>{stage}</td>
      </tr>
      {items.map((l) => {
        const c = t.counts.get(l.legend_id)!;
        return (
          <tr
            key={l.legend_id}
            className={`click ${l.legend_id === t.selectedLegendId ? "active" : ""}`}
            onClick={() => t.setSelectedLegendId(l.legend_id === t.selectedLegendId ? null : l.legend_id)}
          >
            <td>
              <span className="label">
                <span className="swatch" style={{ background: l.color }} />
                <span title={l.label}>{l.label}</span>
              </span>
            </td>
            <td className={`num ${c.sheet ? "" : "zero"}`}>{c.sheet}</td>
            <td className="num">{c.total}</td>
            <td className="num">{c.total * t.plots}</td>
          </tr>
        );
      })}
    </>
  );
}

function Plots({ t }: { t: Takeoff }) {
  const cable = useMemo(() => {
    const lib = new Map(t.library.map((s) => [s.legend_id || s.symbol_id, s]));
    const byType = new Map<string, number>();
    const missing: LegendItem[] = [];
    for (const l of t.legends) {
      const c = t.counts.get(l.legend_id);
      if (!c?.total) continue;
      const s = lib.get(l.legend_id);
      if (!s?.cable_per_point_m || !s.cable_type) {
        missing.push(l);
        continue;
      }
      byType.set(s.cable_type, (byType.get(s.cable_type) ?? 0) + s.cable_per_point_m * c.total);
    }
    return { rows: [...byType.entries()].sort((a, b) => b[1] - a[1]), missing };
  }, [t.library, t.legends, t.counts]);

  return (
    <div className="scroll grow">
      <div className="section">
        <span className="eyebrow">Plots of this house type</span>
        <div className="row">
          <button className="icon-btn" aria-label="Fewer plots" onClick={() => t.setPlots(t.plots - 1)}>
            <Minus size={15} />
          </button>
          <input
            className="input mono"
            style={{ textAlign: "center", fontSize: 16, fontWeight: 600, height: 38 }}
            type="number"
            min={1}
            value={t.plots}
            onChange={(e) => t.setPlots(Number(e.target.value))}
            aria-label="Number of plots"
          />
          <button className="icon-btn" aria-label="More plots" onClick={() => t.setPlots(t.plots + 1)}>
            <Plus size={15} />
          </button>
        </div>
        <div className="callout">
          <Info size={14} />
          <span>
            Take this from the accommodation schedule: filter by house type and count the plots. Every quantity is
            multiplied by it.
          </span>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <span className="eyebrow">First fix cable estimate</span>
          <Cable size={14} className="muted" />
        </div>
        {cable.rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No cable allowances yet for the symbols you've counted. Add metres per point in the symbol library.
          </p>
        ) : (
          <table className="boq" style={{ margin: "0 -14px", width: "calc(100% + 28px)" }}>
            <thead>
              <tr>
                <th>Cable</th>
                <th>Per plot</th>
                <th>× {t.plots}</th>
              </tr>
            </thead>
            <tbody>
              {cable.rows.map(([type, m]) => (
                <tr key={type}>
                  <td>{type}</td>
                  <td className="num">{Math.round(m)} m</td>
                  <td className="num">{Math.round(m * t.plots).toLocaleString()} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Metres per point come from the symbol library. Lewis's per-item cable and labour figures will replace these
          once the updated Second Fix sheet arrives.
        </p>
        {cable.missing.length > 0 && (
          <div className="callout">
            <Info size={14} />
            <span>
              No cable allowance for {cable.missing.length} counted symbol{cable.missing.length > 1 ? "s" : ""}:{" "}
              {cable.missing.slice(0, 4).map((l) => l.label).join(", ")}
              {cable.missing.length > 4 ? "…" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

