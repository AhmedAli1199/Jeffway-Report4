import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { cx } from "../lib/util";

export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  icon?: ReactNode;
  run: () => void;
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      const hay = `${it.label} ${it.hint ?? ""} ${it.group}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    setTimeout(it.run, 0);
  };

  let lastGroup = "";
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Command bar">
        <div className="search">
          <Search size={16} />
          <input
            autoFocus
            className="input"
            placeholder="Jump to a sheet, symbol or action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[active]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <div className="results scroll" ref={listRef}>
          {results.length === 0 && <div className="empty"><p>No matches for “{q}”.</p></div>}
          {results.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head && <div className="group eyebrow">{head}</div>}
                <button
                  data-i={i}
                  className={cx("menu-item", i === active && "active")}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(it)}
                >
                  {it.icon}
                  <span className="meta">
                    <span className="truncate">{it.label}</span>
                    {it.hint && <small className="truncate">{it.hint}</small>}
                  </span>
                  {it.keys && <span className="kbd">{it.keys}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
