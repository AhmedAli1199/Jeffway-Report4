import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, KeyRound, LoaderCircle, Scale, Sparkles, TriangleAlert, X } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import type { AIModelInfo, AISettings, CompareEstimate, CompareResults } from "../lib/types";
import { cx } from "../lib/util";
import { usd } from "./Costs";
import { Modal } from "./ui";

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const per1000 = (m?: AIModelInfo) => (m?.per_check != null ? usd(m.per_check * 125, 2) : "–"); // 8 marks a check
const src = (b64: string) => (b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`);

/** Which AI model checks borderline marks (OpenAI or any model through OpenRouter), and the side-by-side test. */
export function AIModelModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [cfg, setCfg] = useState<AISettings | null>(null);
  const [models, setModels] = useState<AIModelInfo[]>([]);
  const [provider, setProvider] = useState<"openai" | "openrouter">("openai");
  const [model, setModel] = useState("gpt-4o");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.aiSettings().then((c) => {
      setCfg(c);
      setProvider(c.provider);
      setModel(c.model);
      setKey(c.openrouter_key);
    }).catch(() => {});
    api.aiCatalogue().then((r) => setModels(r.models)).catch(() => {});
  }, []);

  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);
  const current = byId.get(provider === "openai" ? `openai/${model}` : model);

  const save = async (patch?: { provider?: string; model?: string }) => {
    setSaving(true);
    try {
      const c = await api.saveAISettings({ provider, model, openrouter_key: key, ...patch });
      setCfg(c);
      setProvider(c.provider);
      setModel(c.model);
      setKey(c.openrouter_key);
      toast({ tone: "success", title: "AI model saved", body: `${c.provider === "openrouter" ? "OpenRouter" : "OpenAI"} · ${c.model}` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal wide title="AI model" subtitle="Which model checks borderline marks, and a side-by-side test on your own past checks" onClose={onClose}>
      <section className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label>Send AI checks to</label>
          <div className="seg" role="group">
            <button type="button" aria-pressed={provider === "openai"} onClick={() => { setProvider("openai"); setModel(model.startsWith("openai/") ? model.slice(7) : "gpt-4o"); }}>
              OpenAI directly
            </button>
            <button type="button" aria-pressed={provider === "openrouter"} onClick={() => { setProvider("openrouter"); if (!model.includes("/")) setModel(`openai/${model}`); }}>
              OpenRouter (Gemini, GPT, Claude …)
            </button>
          </div>
        </div>

        {provider === "openrouter" && (
          <div className="field">
            <label htmlFor="or-key">OpenRouter API key</label>
            <div className="search">
              <KeyRound size={14} />
              <input id="or-key" className="input" type="password" autoComplete="off" placeholder="sk-or-…" value={key}
                onChange={(e) => setKey(e.target.value)} />
            </div>
            <span className="hint">Saved on this computer only (backend/data/ai_settings.json, never committed) and never shown again in full.</span>
          </div>
        )}
        {provider === "openai" && (
          <span className="hint">
            Uses the OpenAI key from Settings in the workspace, or the backend's .env file
            {cfg?.openai_key_on_server ? " (a key is set there)." : " (none set there yet)."}
          </span>
        )}

        <div className="field">
          <label htmlFor="ai-model">Model</label>
          <select id="ai-model" className="select" value={model} onChange={(e) => setModel(e.target.value)}>
            {provider === "openai"
              ? ["gpt-4o", "gpt-4o-mini", "gpt-5-mini"].map((m) => (
                  <option key={m} value={m}>{m} · {per1000(byId.get(`openai/${m}`))} per 1,000 marks</option>
                ))
              : (["suggested", "other", "all"] as const).map((g) => (
                  <optgroup key={g} label={g === "suggested" ? "Suggested" : g === "other" ? "Other good options" : "Every vision model on OpenRouter"}>
                    {models.filter((m) => m.group === g).map((m) => (
                      <option key={m.id} value={m.id}>{m.label} · {per1000(m)} per 1,000 marks</option>
                    ))}
                  </optgroup>
                ))}
          </select>
          {current?.input_per_m != null && (
            <span className="hint">
              ${current.input_per_m} in / ${current.output_per_m} out per 1M tokens · about {usd(current.per_check ?? 0, 4)} per AI check of 8 marks
            </span>
          )}
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={saving} onClick={() => save()}>
            {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Save
          </button>
          {cfg && (
            <span className="muted" style={{ fontSize: 12 }}>
              Now using <b>{cfg.provider === "openrouter" ? "OpenRouter" : "OpenAI"} · {cfg.model}</b>
              {!cfg.ready && " · no key yet"}
            </span>
          )}
        </div>
      </section>

      <hr />
      <Comparison models={models} keySet={!!cfg?.openrouter_key_set} onUse={(m) => { setProvider("openrouter"); setModel(m); save({ provider: "openrouter", model: m }); }} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ comparison */

function Comparison({ models, keySet, onUse }: { models: AIModelInfo[]; keySet: boolean; onUse: (m: string) => void }) {
  const toast = useToast();
  const suggested = models.filter((m) => m.group === "suggested" && m.id !== "openai/gpt-4o");
  const [picked, setPicked] = useState<string[]>([]);
  const [checks, setChecks] = useState(30);
  const [est, setEst] = useState<CompareEstimate | null>(null);
  const [res, setRes] = useState<CompareResults | null>(null);
  const [only, setOnly] = useState<"open" | "all">("open");

  useEffect(() => {
    if (!picked.length && suggested.length) setPicked(suggested.map((m) => m.id));
  }, [suggested.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.compareResults().then(setRes).catch(() => {});
  }, []);
  useEffect(() => {
    if (res?.status !== "running") return;
    const h = setInterval(() => api.compareResults().then(setRes).catch(() => {}), 2000);
    return () => clearInterval(h);
  }, [res?.status]);
  useEffect(() => {
    const h = setTimeout(() => api.compareEstimate({ models: ["openai/gpt-4o", ...picked], checks }).then(setEst).catch(() => {}), 250);
    return () => clearTimeout(h);
  }, [picked, checks]);

  const run = async () => {
    try {
      setRes(await api.compareStart({ models: picked, checks }));
    } catch (e) {
      toast({ tone: "error", title: "Couldn't start the comparison", body: (e as Error).message });
    }
  };
  const label = async (id: string, valid: boolean) => {
    try {
      setRes(await api.compareLabel(id, valid));
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
    }
  };

  const name = (id: string) => models.find((m) => m.id === id)?.label.replace(/ \(.*\)$/, "") ?? id;
  const shown = (res?.disagreements ?? []).filter((d) => only === "all" || d.judged == null);

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="section-head">
        <span className="row" style={{ gap: 8 }}><Scale size={16} /><b>Compare models on your own checks</b></span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Replays saved AI checks (the same pictures and instructions GPT-4o was sent) through each model, then scores every
        model against the marks a person approved or deleted in the review queue, and the ones you judge below. The winner is
        the cheapest model that is at least as accurate as GPT-4o and removes no more real symbols.
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {suggested.concat(models.filter((m) => m.group === "other")).map((m) => (
          <label key={m.id} className={cx("chip-check", picked.includes(m.id) && "on")}>
            <input type="checkbox" checked={picked.includes(m.id)}
              onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))} />
            {name(m.id)} <span className="muted mono">{per1000(m)}/1k</span>
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        <div className="field" style={{ minWidth: 240 }}>
          <label htmlFor="cmp-n">Saved checks to replay: {checks} (about {checks * 8} marks)</label>
          <input id="cmp-n" type="range" className="slider" min={5} max={100} step={5} value={checks} onChange={(e) => setChecks(Number(e.target.value))} />
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {est ? <>{est.checks} saved checks available · costs about <b>{usd(est.total, 2)}</b> for all {picked.length + 1} models (GPT-4o included as the yardstick)</> : "…"}
        </span>
        <button className="btn btn-copper" disabled={!keySet || res?.status === "running" || !picked.length} onClick={run}
          title={keySet ? "" : "Save your OpenRouter key above first"}>
          {res?.status === "running" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} Run comparison
        </button>
      </div>
      {!keySet && <span className="hint">The comparison runs every model through OpenRouter, so save your OpenRouter key above first.</span>}

      {res?.status === "running" && (
        <div className="callout">
          <LoaderCircle size={14} className="spin" />
          <span className="grow">Replaying {res.done} of {res.total} checks…
            <span className="progress-line" style={{ display: "block" }}><i style={{ width: `${res.total ? ((res.done ?? 0) / res.total) * 100 : 3}%` }} /></span>
          </span>
        </div>
      )}

      {res?.scores && res.scores.length > 0 && (
        <>
          {res.status === "done" && (
            <div className="callout" style={res.recommended ? undefined : { background: "var(--review-soft)" }}>
              {res.recommended ? <CircleCheck size={14} style={{ color: "var(--ok)" }} /> : <TriangleAlert size={14} style={{ color: "var(--review)" }} />}
              <span className="grow"><b>{res.recommended ? `Use ${name(res.recommended)}` : "No winner yet"}:</b> {res.why}</span>
              {res.recommended && res.recommended !== "openai/gpt-4o" && (
                <button className="btn btn-primary btn-sm" onClick={() => onUse(res.recommended!)}>Use this model</button>
              )}
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="boq" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>Model</th>
                  <th title="Right answers on marks a person has judged">Right vs people</th>
                  <th title="Real symbols the model said were false: causes an under-count">Removed real</th>
                  <th title="False matches the model kept: causes an over-count">Kept wrong</th>
                  <th>Agrees with GPT-4o</th>
                  <th>Per 1,000 marks</th>
                  <th>Seconds a check</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {res.scores.map((r) => (
                  <tr key={r.model} className={cx(r.model === res.recommended && "row-win")}>
                    <td><b>{name(r.model)}</b>{r.model === res.recommended && <span className="pill pill-ok" style={{ marginLeft: 6 }}>best value</span>}</td>
                    <td className="mono">{pct(r.accuracy)} <span className="muted">({r.right}/{r.judged})</span></td>
                    <td className="mono">{r.judged ? r.removed_real : "–"}</td>
                    <td className="mono">{r.judged ? r.kept_wrong : "–"}</td>
                    <td className="mono">{r.model === "openai/gpt-4o" ? "–" : pct(r.agrees_with_gpt4o)}</td>
                    <td className="mono">{r.cost_per_1000_marks != null ? usd(r.cost_per_1000_marks, 2) : "–"}</td>
                    <td className="mono">{r.seconds_per_check ?? "–"}</td>
                    <td className="mono" title={r.errors.join("\n")}>{r.failed || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-head">
            <span className="eyebrow">
              {res.disagreement_count} marks where the models disagree · {res.judged_marks} of the replayed marks judged by a person
              (need {res.min_judged} for a verdict)
            </span>
            <div className="seg" role="group">
              <button aria-pressed={only === "open"} onClick={() => setOnly("open")}>Not judged</button>
              <button aria-pressed={only === "all"} onClick={() => setOnly("all")}>All</button>
            </div>
          </div>
          <div className="cand-grid">
            {shown.slice(0, 60).map((d) => (
              <div key={d.marker_id} className={cx("cand", d.judged === true ? "kept" : d.judged === false ? "removed" : "none")}>
                <div className="cand-img"><img src={src(d.patch_b64)} alt={d.legend} /></div>
                <div className="cand-body">
                  <div className="cand-meta"><b className="truncate">{d.legend}</b></div>
                  {Object.entries(d.answers).map(([m, a]) => (
                    <p key={m} title={a.reason} style={{ margin: 0, fontSize: 11.5 }}>
                      {a.valid ? <Check size={11} style={{ color: "var(--ok)" }} /> : <X size={11} style={{ color: "var(--reject)" }} />} {name(m)}
                    </p>
                  ))}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <button className={cx("btn btn-sm", d.judged === true ? "btn-primary" : "btn-ghost")} onClick={() => label(d.marker_id, true)}>Real {d.legend.split(" ")[0]}</button>
                    <button className={cx("btn btn-sm", d.judged === false ? "btn-primary" : "btn-ghost")} onClick={() => label(d.marker_id, false)}>Not this symbol</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
