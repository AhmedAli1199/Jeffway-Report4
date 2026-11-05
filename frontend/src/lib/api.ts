import type {
  AuditLog,
  ExcludedZone,
  LegendItem,
  LibrarySymbol,
  Marker,
  ProjectDetails,
  ProjectSummary,
  Rect,
  RoomZone,
  Verification,
} from "./types";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8008/api";

function errorText(body: unknown, fallback: string): string {
  if (!body) return fallback;
  if (typeof body === "string") return body;
  const b = body as { detail?: unknown; message?: unknown };
  if (typeof b.detail === "string") return b.detail;
  if (Array.isArray(b.detail)) {
    return b.detail
      .map((d: { msg?: string; loc?: string[] }) => d.msg ?? (d.loc ? d.loc.join(".") : JSON.stringify(d)))
      .join("; ");
  }
  if (typeof b.message === "string") return b.message;
  return fallback;
}

async function request<T>(path: string, init?: RequestInit, fallback = "Request failed"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error(`Can't reach the takeoff engine at ${API_BASE}. Is the backend running?`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(errorText(body, `${fallback} (${res.status})`));
  }
  return res.json() as Promise<T>;
}

function postJson<T>(path: string, payload: unknown, fallback?: string): Promise<T> {
  return request<T>(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    fallback,
  );
}

async function download(path: string, payload: unknown, filename: string, fallback: string) {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`Can't reach the takeoff engine at ${API_BASE}.`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(errorText(body, fallback));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface ExportPayload {
  project_id: string;
  project_name: string;
  filepath: string;
  legends: LegendItem[];
  markers: Marker[];
}

const q = encodeURIComponent;

export const api = {
  listProjects: () => request<ProjectSummary[]>("/projects/list", undefined, "Couldn't load projects"),

  projectDetails: (id: string, filepath?: string) =>
    request<ProjectDetails>(
      `/projects/${q(id)}/details${filepath ? `?filepath=${q(filepath)}` : ""}`,
      undefined,
      "Couldn't open project",
    ),

  async uploadPdf(file: File): Promise<ProjectSummary> {
    const form = new FormData();
    form.append("file", file);
    return request<ProjectSummary>("/projects/upload", { method: "POST", body: form }, "Upload failed");
  },

  pageImageUrl: (filepath: string, page: number, dpi = 200) =>
    `${API_BASE}/projects/page-image?filepath=${q(filepath)}&page_index=${page}&dpi=${dpi}`,

  thumbnailUrl: (filepath: string, page: number) =>
    `${API_BASE}/projects/thumbnail?filepath=${q(filepath)}&page_index=${page}`,

  async legendZone(filepath: string, page: number): Promise<ExcludedZone | null> {
    try {
      const r = await request<{ legend_zone: ExcludedZone | null }>(
        `/takeoff/legend-zone?filepath=${q(filepath)}&page_index=${page}&dpi=200`,
      );
      return r.legend_zone;
    } catch {
      return null;
    }
  },

  autoCount: (payload: {
    project_id: string;
    filepath: string;
    page_index: number;
    legend: LegendItem;
    min_confidence?: number;
    excluded_zones?: ExcludedZone[];
  }) =>
    postJson<{ legend_id: string; total_detected: number; markers: Marker[]; legend_zone?: ExcludedZone }>(
      "/takeoff/auto-count",
      payload,
      "Count failed",
    ),

  saveState: (payload: {
    project_id: string;
    legends: LegendItem[];
    markers: Marker[];
    rooms: RoomZone[];
    excluded_zones: Record<string, ExcludedZone[]>;
  }) => postJson<{ status: string }>("/takeoff/save-state", payload, "Save failed"),

  verifyCandidates: (payload: {
    filepath: string;
    page_index: number;
    legend: LegendItem;
    markers: Marker[];
    api_key?: string;
    all_legends?: LegendItem[];
    excluded_zones?: ExcludedZone[];
  }) => postJson<{ verifications: Verification[] }>("/takeoff/verify-candidates-ai", payload, "AI check failed"),

  auditLogs: () => request<{ logs: AuditLog[] }>("/takeoff/audit-logs"),
  clearAuditLogs: () => postJson<unknown>("/takeoff/clear-audit-logs", {}),

  scanLegend: (payload: { filepath: string; page_index: number; crop_coords?: Rect; api_key?: string }) =>
    postJson<{ symbols: Array<Record<string, string>> }>("/ai/scan-legend", payload, "Legend read failed"),

  detectRooms: (payload: { filepath: string; page_index: number; api_key?: string }) =>
    postJson<{ rooms: RoomZone[] }>("/ai/detect-rooms", payload, "Room detection failed"),

  library: () => request<LibrarySymbol[]>("/symbols/library", undefined, "Couldn't load symbol library"),
  saveLibrary: (lib: LibrarySymbol[]) => postJson<unknown>("/symbols/library", lib, "Couldn't save symbol library"),

  exportTakeoff: (p: ExportPayload) =>
    download("/exports/excel", p, `${p.project_name} - Takeoff.xlsx`, "Excel export failed"),
  exportTender: (p: ExportPayload) =>
    download("/exports/master-tender", p, `${p.project_name} - Master Tender.xlsx`, "Tender workbook export failed"),
  exportPdf: (p: ExportPayload) =>
    download("/exports/pdf", p, `${p.project_name} - Marked up.pdf`, "PDF export failed"),
};
