import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "../lib/util";
import type { LegendItem } from "../lib/types";

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.icon-btn)");
    first?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx("modal", wide && "wide", className)} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body scroll">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A button that opens a dropdown menu anchored below it. */
export function MenuButton({
  trigger,
  children,
  align = "left",
  className,
  label,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  label: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const open = controlledOpen ?? own;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setOwn(o));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", minWidth: 0 }}>
      <button
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div className="menu" role="menu" style={{ top: "calc(100% + 6px)", [align]: 0 }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function SymbolSample({ legend, size = 30 }: { legend: LegendItem | null; size?: number }) {
  if (!legend) return <span className="sym-sample empty" style={{ width: size, height: size }} />;
  return (
    <span
      className={cx("sym-sample", !legend.template_image_b64 && "empty")}
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 1.5px ${legend.color}` }}
      title={legend.template_image_b64 ? "Sample crop" : "No sample yet"}
    >
      {legend.template_image_b64 ? (
        <img src={legend.template_image_b64} alt="" style={{ maxWidth: size - 6, maxHeight: size - 6 }} />
      ) : (
        <span className="swatch" style={{ background: legend.color }} />
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}
