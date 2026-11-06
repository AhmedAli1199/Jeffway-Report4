import { useEffect, useState, useSyncExternalStore } from "react";
import { Coins } from "lucide-react";
import { api } from "../lib/api";
import type { CostSummary } from "../lib/types";
import { Modal } from "./ui";

/* One shared poller so every header shows the same running total. */
let current: CostSummary | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export async function refreshCosts() {
  try {
    current = await api.costs();
    listeners.forEach((l) => l());
  } catch {
    /* backend offline: keep the last value */
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) {
    refreshCosts();
    timer = setInterval(refreshCosts, 8000);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export const useCosts = () => useSyncExternalStore(subscribe, () => current);

export const usd = (n: number | undefined, dp = 2) =>
  n == null ? "–" : n > 0 && n < 0.01 && dp <= 2 ? "<$0.01" : `$${n.toFixed(dp)}`;

export function CostPill() {
  const c = useCosts();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="cost-pill" onClick={() => setOpen(true)} title="AI spend: click for the breakdown">
        <Coins size={14} />
        <span className="mono">{usd(c?.today)}</span>
        <span className="muted">today</span>
        <span className="sep-dot" />
        <span className="mono">{usd(c?.total)}</span>
        <span className="muted">total</span>
      </button>
      {open && <CostModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CostModal({ onClose }: { onClose: () => void }) {
  const c = useCosts();
  useEffect(() => {
    refreshCosts();
  }, []);
  const maxDay = Math.max(0.0001, ...(c?.by_day ?? []).map((d) => d.cost));
  return (
    <Modal
      wide
      title="AI spend"
      subtitle="Every AI call is logged with its real token usage and priced at OpenAI list prices (USD)."
      onClose={onClose}
    >
      {!c ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : (
        <>
          <div className="tiles">
            <div className="tile accent"><b>{usd(c.today)}</b><span>Today</span></div>
            <div className="tile"><b>{usd(c.total)}</b><span>All time</span></div>
            <div className="tile"><b>{c.calls}</b><span>AI calls</span></div>
            <div className="tile">
              <b>{usd(c.cost_per_call, 3)}</b>
              <span>Per call (8 marks) · {c.estimate_basis}</span>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <span className="eyebrow">By tender</span>
              {c.by_tender.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No AI calls yet.</p>
              ) : (
                <table className="boq">
                  <thead><tr><th>Tender</th><th>Calls</th><th>Spent</th></tr></thead>
                  <tbody>
                    {c.by_tender.map((t) => (
                      <tr key={t.tag}><td>{t.name}</td><td className="num">{t.calls}</td><td className="num">{usd(t.cost)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <span className="eyebrow">Last 30 days</span>
              {c.by_day.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Nothing spent yet.</p>
              ) : (
                <div className="day-bars">
                  {c.by_day.map((d) => (
                    <div key={d.day} className="day-bar">
                      <span className="mono muted">{d.day.slice(5)}</span>
                      <span className="track"><i style={{ width: `${(d.cost / maxDay) * 100}%` }} /></span>
                      <span className="mono">{usd(d.cost)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {c.recent.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px 0" }}><span className="eyebrow">Recent calls</span></div>
              <div style={{ overflowX: "auto" }}>
                <table className="boq">
                  <thead><tr><th>When</th><th>Model</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
                  <tbody>
                    {c.recent.map((r, i) => (
                      <tr key={i}>
                        <td>{new Date(r.ts * 1000).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                        <td>{r.model}</td>
                        <td className="num">{r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}</td>
                        <td className="num">{usd(r.cost, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Prices per 1M tokens (in / out):{" "}
            {Object.entries(c.prices).map(([m, [i, o]]) => `${m} $${i} / $${o}`).join(" · ")}. Your OpenAI invoice is the final word.
          </p>
        </>
      )}
    </Modal>
  );
}
