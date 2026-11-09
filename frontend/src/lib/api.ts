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
  Tender,
  TenderHouseMarks,
  RunSettings,
  AIEstimate,
  CostSummary,
  AISettings,
  AIModelInfo,
  CompareEstimate,
  CompareResults,
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

export interface PackFile {
  file: File;
  path: string;
}

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
  auditLog: (id: string) => request<AuditLog>(`/takeoff/audit-logs/${q(id)}`, undefined, "Couldn't load that AI check"),
  clearAuditLogs: () => postJson<unknown>("/takeoff/clear-audit-logs", {}),

  scanLegend: (payload: { filepath: string; page_index: number; crop_coords?: Rect; api_key?: string }) =>
    postJson<{ symbols: Array<Record<string, string>> }>("/ai/scan-legend", payload, "Legend read failed"),

  detectRooms: (payload: { filepath: string; page_index: number; api_key?: string }) =>
    postJson<{ rooms: RoomZone[] }>("/ai/detect-rooms", payload, "Room detection failed"),

  library: () => request<LibrarySymbol[]>("/symbols/library", undefined, "Couldn't load symbol library"),
  addSymbol: (body: Record<string, unknown>) => postJson<LibrarySymbol>("/symbols/library/add", body, "Couldn't add the symbol"),
  async deleteSymbol(id: string): Promise<void> {
    await request<unknown>(`/symbols/library/${q(id)}`, { method: "DELETE" }, "Couldn't delete the symbol");
  },
  workbookRows: () =>
    request<{ row: number; description: string; manufacturer: string; part_code: string; unit_price: number | null }[]>(
      "/symbols/workbook-rows", undefined, "Couldn't read the workbook lines"),
  async uploadSourcePdf(file: File): Promise<{ filepath: string; name: string; pages: { page_index: number; page_number: number }[] }> {
    const form = new FormData();
    form.append("file", file, file.name);
    return request("/symbols/source-pdf", { method: "POST", body: form }, "Couldn't open that PDF");
  },
  saveLibrary: (lib: LibrarySymbol[]) => postJson<unknown>("/symbols/library", lib, "Couldn't save symbol library"),

  // ---- Tender pipeline
  tenders: () => request<Tender[]>("/tenders", undefined, "Couldn't load tenders"),
  tender: (id: string) => request<Tender>(`/tenders/${q(id)}`, undefined, "Couldn't load tender"),
  async uploadTender(files: PackFile[], name?: string): Promise<Tender> {
    const form = new FormData();
    for (const f of files) {
      form.append("files", f.file, f.file.name);
      form.append("paths", f.path);
    }
    if (name) form.append("name", name);
    return request<Tender>("/tenders/upload", { method: "POST", body: form }, "Upload failed");
  },
  runTender: (id: string, s: Partial<RunSettings>) => postJson<Tender>(`/tenders/${q(id)}/run`, s, "Couldn't start the run"),
  tenderMarks: (id: string) =>
    request<{ tender: Tender; house_types: TenderHouseMarks[] }>(`/tenders/${q(id)}/marks`, undefined, "Couldn't load marks"),
  decide: (id: string, body: { project_id: string; marker_id: string; action: "approve" | "reject" | "restore"; marker?: Marker }) =>
    postJson<{ ok: boolean }>(`/tenders/${q(id)}/decision`, body, "Couldn't save decision"),
  approveMany: (id: string, project_ids: string[], marker_ids: string[]) =>
    postJson<{ approved: number }>(`/tenders/${q(id)}/approve-many`, { project_ids, marker_ids }, "Couldn't approve"),
  aiSettings: () => request<AISettings>("/ai-models/settings", undefined, "Couldn't load AI settings"),
  saveAISettings: (body: { provider?: string; model?: string; openrouter_key?: string }) =>
    postJson<AISettings>("/ai-models/settings", body, "Couldn't save AI settings"),
  aiCatalogue: () => request<{ models: AIModelInfo[] }>("/ai-models/catalogue", undefined, "Couldn't load the model list"),
  compareEstimate: (body: { models: string[]; checks: number }) =>
    postJson<CompareEstimate>("/ai-models/compare/estimate", body, "Couldn't estimate"),
  compareStart: (body: { models: string[]; checks: number }) =>
    postJson<CompareResults>("/ai-models/compare", body, "Couldn't start the comparison"),
  compareResults: () => request<CompareResults>("/ai-models/compare", undefined, "Couldn't load the comparison"),
  compareLabel: (marker_id: string, valid: boolean) =>
    postJson<CompareResults>("/ai-models/compare/label", { marker_id, valid }, "Couldn't save"),
  aiEstimate: (id: string, body: { ai_low: number; auto_high: number; max_ai_marks?: number; project_ids?: string[] }) =>
    postJson<AIEstimate>(`/tenders/${q(id)}/ai-estimate`, body, "Couldn't estimate"),
  aiRun: (id: string, body: { ai_low: number; auto_high: number; max_ai_marks?: number; api_key?: string; project_ids?: string[] }) =>
    postJson<Tender>(`/tenders/${q(id)}/ai-run`, body, "Couldn't start the AI check"),
  async uploadSchedule(id: string, file: File): Promise<Tender> {
    const form = new FormData();
    form.append("file", file, file.name);
    return request<Tender>(`/tenders/${q(id)}/schedule`, { method: "POST", body: form }, "Couldn't read that schedule");
  },
  exportTenderWorkbook: (id: string, name: string, mode: "counted" | "approved", threshold: number) =>
    download(`/tenders/${q(id)}/export`, { mode, threshold }, `${name} - Tender workbook.xlsx`, "Workbook export failed"),
  stopTender: (id: string) => postJson<Tender>(`/tenders/${q(id)}/stop`, {}, "Couldn't stop the run"),
  resetTender: (id: string) => postJson<Tender>(`/tenders/${q(id)}/reset`, {}, "Couldn't clear the tender"),
  async deleteTender(id: string): Promise<void> {
    await request<unknown>(`/tenders/${q(id)}`, { method: "DELETE" }, "Couldn't delete the tender");
  },
  setSheets: (id: string, rel_path: string, page_indexes: number[]) =>
    postJson<Tender>(`/tenders/${q(id)}/sheets`, { rel_path, page_indexes }, "Couldn't save the sheet choice"),
  pagePreviewUrl: (filepath: string, page: number, width = 2400) =>
    `${API_BASE}/tenders/preview/page?filepath=${q(filepath)}&page_index=${page}&w=${Math.round(width)}`,
  costs: () => request<CostSummary>("/tenders/costs/summary", undefined, "Couldn't load AI spend"),
  setPlots: (id: string, project_id: string, plots: number) =>
    postJson<Tender>(`/tenders/${q(id)}/plots`, { project_id, plots }, "Couldn't save plots"),
  cropUrl: (filepath: string, page: number, m: { x: number; y: number; width: number; height: number }, pad = 2.2, size = 360, exact = false) =>
    `${API_BASE}/tenders/crop/image?filepath=${q(filepath)}&page_index=${page}&x=${m.x}&y=${m.y}&w=${m.width}&h=${m.height}&pad=${pad}&size=${size}${exact ? "&exact=true" : ""}`,

  exportTakeoff: (p: ExportPayload) =>
    download("/exports/excel", p, `${p.project_name} - Takeoff.xlsx`, "Excel export failed"),
  exportTender: (p: ExportPayload) =>
    download("/exports/master-tender", p, `${p.project_name} - Master Tender.xlsx`, "Tender workbook export failed"),
  exportPdf: (p: ExportPayload) =>
    download("/exports/pdf", p, `${p.project_name} - Marked up.pdf`, "PDF export failed"),
};
