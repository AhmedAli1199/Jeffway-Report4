import type { Project, LegendItem, Marker, RoomZone } from "../types/takeoff";

const API_BASE = "http://127.0.0.1:8008/api";

function formatError(err: any): string {
  if (!err) return "Inference failed";
  if (typeof err === "string") return err;
  if (typeof err.detail === "string") return err.detail;
  if (Array.isArray(err.detail)) {
    return err.detail.map((d: any) => d.msg || (d.loc ? `${d.loc.join('.')}: ${d.type}` : JSON.stringify(d))).join("; ");
  }
  if (typeof err.message === "string") return err.message;
  return JSON.stringify(err);
}

export const api = {
  async listProjects(): Promise<Project[]> {
    const res = await fetch(`${API_BASE}/projects/list`);
    if (!res.ok) throw new Error("Failed to fetch projects");
    return res.json();
  },

  async getProjectDetails(projectId: string, filepath?: string): Promise<{
    project_id: string;
    name: string;
    filename: string;
    filepath: string;
    total_pages: number;
    pages: any[];
    legends: LegendItem[];
    markers: Marker[];
    rooms: RoomZone[];
    excluded_zones?: Record<string, any>;
  }> {
    const url = new URL(`${API_BASE}/projects/${projectId}/details`);
    if (filepath) url.searchParams.append("filepath", filepath);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Failed to fetch project details");
    return res.json();
  },

  getPageImageUrl(filepath: string, pageIndex: number, dpi: number = 200): string {
    return `${API_BASE}/projects/page-image?filepath=${encodeURIComponent(filepath)}&page_index=${pageIndex}&dpi=${dpi}`;
  },

  getThumbnailUrl(filepath: string, pageIndex: number): string {
    return `${API_BASE}/projects/thumbnail?filepath=${encodeURIComponent(filepath)}&page_index=${pageIndex}`;
  },

  async getLegendZone(filepath: string, pageIndex: number, dpi: number = 200): Promise<{ legend_zone: any }> {
    const url = new URL(`${API_BASE}/takeoff/legend-zone`);
    url.searchParams.append("filepath", filepath);
    url.searchParams.append("page_index", pageIndex.toString());
    url.searchParams.append("dpi", dpi.toString());
    const res = await fetch(url.toString());
    if (!res.ok) return { legend_zone: null };
    return res.json();
  },

  async runAutoCount(payload: {
    project_id: string;
    filepath: string;
    page_index: number;
    legend: LegendItem;
    dpi?: number;
    min_confidence?: number;
    angles?: number[];
    excluded_zones?: any[];
  }): Promise<{ legend_id: string; total_detected: number; markers: Marker[]; legend_zone?: any }> {
    const res = await fetch(`${API_BASE}/takeoff/auto-count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Inference failed" }));
      throw new Error(formatError(err));
    }
    return res.json();
  },

  async saveState(payload: {
    project_id: string;
    legends: LegendItem[];
    markers: Marker[];
    rooms?: RoomZone[];
    excluded_zones?: Record<string, any>;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/takeoff/save-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async exportExcel(payload: {
    project_id: string;
    project_name: string;
    filepath: string;
    legends: LegendItem[];
    markers: Marker[];
  }): Promise<void> {
    const res = await fetch(`${API_BASE}/exports/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Excel export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.project_name}_Jeffway_Takeoff.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  async exportMasterTender(payload: {
    project_id: string;
    project_name: string;
    filepath: string;
    legends: LegendItem[];
    markers: Marker[];
  }): Promise<void> {
    const res = await fetch(`${API_BASE}/exports/master-tender`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Master Tender Excel export failed");
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const clean = payload.project_name.replace("The ", "").trim();
    a.download = `Jeffway_Master_Tender_${clean}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  async getSymbolLibrary(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/symbols/library`);
    if (!res.ok) throw new Error("Failed to fetch symbol library");
    return res.json();
  },

  async updateSymbolLibrary(library: any[]): Promise<void> {
    const res = await fetch(`${API_BASE}/symbols/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(library),
    });
    if (!res.ok) throw new Error("Failed to update symbol library");
  },

  async exportPdf(payload: {
    project_id: string;
    project_name: string;
    filepath: string;
    legends: LegendItem[];
    markers: Marker[];
  }): Promise<void> {
    const res = await fetch(`${API_BASE}/exports/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("PDF export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.project_name}_Annotated_Takeoff.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  async scanLegendAI(payload: {
    filepath: string;
    page_index: number;
    api_key?: string;
  }): Promise<{ symbols: any[] }> {
    const res = await fetch(`${API_BASE}/ai/scan-legend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "AI scan failed" }));
      throw new Error(err.detail || "AI scan failed");
    }
    return res.json();
  },

  async detectRoomsAI(payload: {
    filepath: string;
    page_index: number;
    api_key?: string;
  }): Promise<{ rooms: RoomZone[] }> {
    const res = await fetch(`${API_BASE}/ai/detect-rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Room detection failed" }));
      throw new Error(err.detail || "Room detection failed");
    }
    return res.json();
  },

  async verifyCandidatesAI(payload: {
    filepath: string;
    page_index: number;
    legend: LegendItem;
    markers: Marker[];
    api_key?: string;
    all_legends?: LegendItem[];
    excluded_zones?: any[];
  }): Promise<{
    verifications: {
      marker_id: string;
      is_valid: boolean;
      confidence: number;
      reason: string;
      suggested_reclassification?: string;
    }[];
  }> {
    const res = await fetch(`${API_BASE}/takeoff/verify-candidates-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "AI verification failed" }));
      throw new Error(err.detail || "AI verification failed");
    }
    return res.json();
  },

  async getAuditLogs(): Promise<{ logs: any[] }> {
    const res = await fetch(`${API_BASE}/takeoff/audit-logs`);
    if (!res.ok) throw new Error("Failed to fetch audit logs");
    return res.json();
  },

  async clearAuditLogs(): Promise<void> {
    await fetch(`${API_BASE}/takeoff/clear-audit-logs`, { method: "POST" });
  },
};
