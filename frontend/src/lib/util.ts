import { APPROVED, OPEN, type Marker, type PageMeta, type Rect } from "./types";

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

export const isApproved = (m: Marker) => APPROVED.includes(m.status);
export const isOpen = (m: Marker) => OPEN.includes(m.status);

/** A marker counts toward quantities if a person or the AI confirmed it, or it clears the confidence bar. */
export const isCounted = (m: Marker, threshold: number) =>
  isApproved(m) || m.status === "ai_verified" || m.confidence_score >= threshold;

export function roomFor(x: number, y: number, rooms: Array<Rect & { name: string }>): string {
  for (const r of rooms) {
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return r.name;
  }
  return "Unassigned";
}

export function sheetTitle(p: PageMeta): string {
  return p.title?.trim() || `Page ${p.page_number}`;
}

export function drawingNo(p: PageMeta): string | null {
  const d = (p.drawing_no || "").trim();
  if (!d || /drawing|scale|description/i.test(d)) return null;
  return d;
}

export function normRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function timeAgo(d: Date | null): string {
  if (!d) return "Not saved yet";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 5) return "Saved just now";
  if (s < 60) return `Saved ${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `Saved ${m}m ago`;
  return `Saved at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

export const SYMBOL_COLORS = [
  "#E8590C", "#3E63DD", "#0C8599", "#C2255C", "#7048E8",
  "#2F9E44", "#D6336C", "#1971C2", "#E67700", "#5F3DC4",
];

export const CATEGORIES = [
  "Lighting",
  "Switches & Lighting",
  "Power & Accessories",
  "Detectors & Safety",
  "Data & TV",
  "Heating & Ventilation",
  "Specialist",
];

export const FIX_STAGES = ["1st Fix", "2nd Fix", "Communals", "Specialist"] as const;
