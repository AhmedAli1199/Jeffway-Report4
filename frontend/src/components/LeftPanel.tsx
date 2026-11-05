import { useMemo, useState } from "react";
import {
  BookOpen, ChevronDown, ChevronRight, Crop, Ellipsis, Layers, LoaderCircle, Plus, ScanLine, Search, Shapes,
  Sparkles, SquareDashed, Trash, Grid2x2, Check, Eraser, Play,
} from "lucide-react";
import { api } from "../lib/api";
import type { Takeoff } from "../state/useTakeoff";
import type { LegendItem } from "../lib/types";
import { cx, drawingNo, sheetTitle } from "../lib/util";
import { MenuButton, SymbolSample } from "./ui";

export type LeftTab = "sheets" | "symbols" | "rooms";

interface Props {
  t: Takeoff;
  tab: LeftTab;
  setTab: (t: LeftTab) => void;
  rail: boolean;
  onExpand: (tab: LeftTab) => void;
  onOpenLibrary: () => void;
  onNeedKey: () => void;
}

const TABS: { id: LeftTab; label: string; icon: typeof Layers }[] = [
  { id: "sheets", label: "Sheets", icon: Layers },
  { id: "symbols", label: "Symbols", icon: Shapes },
  { id: "rooms", label: "Rooms & areas", icon: Grid2x2 },
];

export function LeftPanel({ t, tab, setTab, rail, onExpand, onOpenLibrary, onNeedKey }: Props) {
  if (rail) {
    return (
      <div className="rail">
        {TABS.map((x) => (
          <button
            key={x.id}
            className={cx("icon-btn", tab === x.id && "on")}
            title={x.label}
            aria-label={x.label}
            onClick={() => onExpand(x.id)}
          >
            <x.icon size={18} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="panel-inner">
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} role="tab" className="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {x.id === "rooms" ? "Rooms" : x.label}
            {x.id === "symbols" && <span className="n">{t.legends.length}</span>}
          </button>
        ))}
      </div>
      {tab === "sheets" && <Sheets t={t} />}
      {tab === "symbols" && <Symbols t={t} onOpenLibrary={onOpenLibrary} onNeedKey={onNeedKey} />}
      {tab === "rooms" && <Rooms t={t} onNeedKey={onNeedKey} />}
    </div>
  );
}

function Sheets({ t }: { t: Takeoff }) {
  const [showAll, setShowAll] = useState(false);
  if (!t.project) return null;
  const elec = t.project.pages.filter((p) => p.is_electrical);
  const other = t.project.pages.filter((p) => !p.is_electrical);

  const row = (p: (typeof elec)[number]) => {
    const n = t.markersOnPage.get(p.page_index) ?? 0;
    const dn = drawingNo(p);
    return (
      <button
        key={p.page_index}
        className={cx("item", p.page_index === t.pageIndex && "active")}
        onClick={() => t.goToPage(p.page_index)}
      >
        <span className="thumb">
          <img loading="lazy" src={api.thumbnailUrl(t.project!.filepath, p.page_index)} alt="" />
        </span>
        <span className="meta">
          <span className="title">{sheetTitle(p)}</span>
          <span className="sub mono">
            p.{p.page_number}
            {dn ? ` · ${dn}` : ""}
          </span>
        </span>
        {n > 0 && <span className="badge-count">{n}</span>}
      </button>
    );
  };

  return (
    <div className="scroll grow">
      <div className="group-label">
        <span className="eyebrow">Electrical · {elec.length}</span>
      </div>
      <div className="list">{elec.length ? elec.map(row) : <p className="muted" style={{ padding: "0 8px" }}>No electrical sheets detected.</p>}</div>
      <button className="group-label btn-quiet" style={{ border: 0, background: "none", width: "100%", cursor: "pointer" }} onClick={() => setShowAll(!showAll)}>
        <span className="eyebrow">Other pages · {other.length}</span>
        {showAll ? <ChevronDown size={14} className="muted" /> : <ChevronRight size={14} className="muted" />}
      </button>
      {showAll && <div className="list">{other.map(row)}</div>}
    </div>
  );
}

function Symbols({ t, onOpenLibrary, onNeedKey }: { t: Takeoff; onOpenLibrary: () => void; onNeedKey: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const list = t.legends.filter((l) => l.label.toLowerCase().includes(q.toLowerCase()));
    const m = new Map<string, LegendItem[]>();
    for (const l of list) {
      const k = l.category || "Other";
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [t.legends, q]);

  const busy = !!t.busy.counting || !!t.busy.batch;

  return (
    <>
      <div className="section" style={{ paddingBottom: 6 }}>
        <div className="row">
          <div className="search grow">
            <Search size={14} />
            <input className="input" placeholder="Find a symbol" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <MenuButton label="Add symbol" className="icon-btn" align="right" trigger={<Plus size={16} />}>
            {(close) => (
              <>
                <button className="menu-item" onClick={() => { close(); t.startCrop(null); }}>
                  <Crop size={15} />
                  <span className="meta">Crop from drawing<small>Draw a box around one example</small></span>
                  <span className="kbd">C</span>
                </button>
                <button className="menu-item" onClick={() => { close(); onOpenLibrary(); }}>
                  <BookOpen size={15} />
                  <span className="meta">Add from symbol library<small>Jeffway's master list with prices and cable</small></span>
                </button>
                <button
                  className="menu-item"
                  onClick={async () => {
                    close();
                    if ((await t.scanLegendAI()) === "needs-key") onNeedKey();
                  }}
                >
                  <Sparkles size={15} />
                  <span className="meta">Read legend with AI<small>Lists the symbols in this sheet's key</small></span>
                </button>
              </>
            )}
          </MenuButton>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={t.countAllOnSheet}>
          {t.busy.batch ? <LoaderCircle size={14} className="spin" /> : <ScanLine size={14} />}
          {t.busy.batch ? `Counting ${t.busy.batch.done + 1} of ${t.busy.batch.total}…` : "Count all symbols on this sheet"}
        </button>
      </div>

      <div className="scroll grow">
        {t.busy.legendScan && (
          <div className="callout" style={{ margin: "4px 14px" }}>
            <LoaderCircle size={14} className="spin" /> Reading the legend…
          </div>
        )}
        {groups.length === 0 && (
          <div className="empty">
            <Shapes size={22} />
            <h3>{q ? "No matches" : "No symbols yet"}</h3>
            <p>{q ? "Try a different name." : "Crop one example from the drawing, or add symbols from the library."}</p>
          </div>
        )}
        {groups.map(([cat, items]) => (
          <div key={cat}>
            <div className="group-label">
              <span className="eyebrow truncate">{cat}</span>
            </div>
            <div className="list">
              {items.map((l) => {
                const c = t.counts.get(l.legend_id);
                const active = l.legend_id === t.selectedLegendId;
                const counting = t.busy.counting === l.label;
                return (
                  <div
                    key={l.legend_id}
                    role="button"
                    tabIndex={0}
                    className={cx("item", active && "active")}
                    onClick={() => t.setSelectedLegendId(active ? null : l.legend_id)}
                    onKeyDown={(e) => e.key === "Enter" && t.setSelectedLegendId(l.legend_id)}
                  >
                    <SymbolSample legend={l} />
                    <span className="meta">
                      <span className="title">{l.label}</span>
                      <span className="sub">
                        {l.fix_stage}
                        {!l.template_image_b64 && !l.template_crop_coords ? " · needs a sample" : ""}
                      </span>
                    </span>
                    {counting ? (
                      <LoaderCircle size={14} className="spin muted" />
                    ) : (
                      <span className={cx("badge-count qty", c && c.open > 0 && "review")} title="On this sheet">
                        {c?.sheet ?? 0}
                      </span>
                    )}
                    <span className="actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn icon-btn-sm" title="Count on this sheet" aria-label="Count on this sheet" disabled={busy} onClick={() => t.countLegend(l)}>
                        <Play size={13} />
                      </button>
                      <MenuButton label="More" className="icon-btn icon-btn-sm" align="right" trigger={<Ellipsis size={14} />}>
                        {(close) => (
                          <>
                            <button className="menu-item" onClick={() => { close(); t.startCrop(l); }}>
                              <Crop size={15} /> <span className="meta">Re-crop sample</span>
                            </button>
                            <button className="menu-item" onClick={() => { close(); t.approveAllForLegend(l.legend_id); }}>
                              <Check size={15} /> <span className="meta">Approve all on this sheet</span>
                            </button>
                            <button className="menu-item" onClick={() => { close(); t.clearOpenForLegend(l.legend_id); }}>
                              <Eraser size={15} /> <span className="meta">Clear unreviewed marks</span>
                            </button>
                            <hr />
                            <button className="menu-item danger" onClick={() => { close(); t.deleteLegend(l.legend_id); }}>
                              <Trash size={15} /> <span className="meta">Remove symbol</span>
                            </button>
                          </>
                        )}
                      </MenuButton>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Rooms({ t, onNeedKey }: { t: Takeoff; onNeedKey: () => void }) {
  const roomCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const mk of t.visibleMarkers) m.set(mk.room, (m.get(mk.room) ?? 0) + 1);
    return m;
  }, [t.visibleMarkers]);

  return (
    <div className="scroll grow">
      <div className="section">
        <div className="section-head">
          <span className="eyebrow">Rooms on this sheet</span>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm grow" onClick={() => t.setTool("room")}>
            <SquareDashed size={14} /> Draw room <span className="kbd">R</span>
          </button>
          <button
            className="btn btn-ghost btn-sm grow"
            disabled={t.busy.rooms}
            onClick={async () => {
              if ((await t.detectRoomsAI()) === "needs-key") onNeedKey();
            }}
          >
            {t.busy.rooms ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} Detect with AI
          </button>
        </div>
      </div>
      <div className="list">
        {t.pageRooms.length === 0 && (
          <p className="muted" style={{ padding: "0 8px 8px" }}>
            No rooms yet. Draw boxes around rooms so each mark is listed by room in the export.
          </p>
        )}
        {t.pageRooms.map((r, i) => (
          <div key={`${r.name}${i}`} className="item">
            <span className="swatch" style={{ background: "var(--fg-3)" }} />
            <span className="meta">
              <span className="title">{r.name}</span>
            </span>
            <span className="badge-count qty">{roomCounts.get(r.name) ?? 0}</span>
            <span className="actions">
              <button className="icon-btn icon-btn-sm" aria-label={`Remove ${r.name}`} title="Remove room" onClick={() => t.removeRoom(r)}>
                <Trash size={13} />
              </button>
            </span>
          </div>
        ))}
        {(roomCounts.get("Unassigned") ?? 0) > 0 && t.pageRooms.length > 0 && (
          <div className="item">
            <span className="swatch" style={{ background: "var(--line-strong)" }} />
            <span className="meta"><span className="title muted">Unassigned</span></span>
            <span className="badge-count">{roomCounts.get("Unassigned")}</span>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <span className="eyebrow">Areas left out of counts</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          The legend table and title block are excluded so their symbols aren't counted as fittings.
        </p>
        <div className="row">
          <button className="btn btn-ghost btn-sm grow" onClick={() => t.setTool("exclude")}>
            <SquareDashed size={14} /> Draw area <span className="kbd">E</span>
          </button>
          <button className="btn btn-ghost btn-sm grow" onClick={t.detectLegendZone}>
            <ScanLine size={14} /> Find legend
          </button>
        </div>
      </div>
      <div className="list">
        {t.zones.map((z, i) => (
          <div key={i} className="item">
            <span className="swatch" style={{ background: "var(--reject)" }} />
            <span className="meta">
              <span className="title">{z.label ?? "Excluded"}</span>
              <span className="sub mono">
                {Math.round(z.width)} × {Math.round(z.height)} px
              </span>
            </span>
            <span className="actions" style={{ display: "flex" }}>
              <button className="icon-btn icon-btn-sm" aria-label="Remove area" title="Remove area" onClick={() => t.removeExcluded(i)}>
                <Trash size={13} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
