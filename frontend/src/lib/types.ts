export interface PageMeta {
  page_index: number;
  page_number: number;
  title: string;
  drawing_no: string;
  display_label: string;
  page_type: string;
  is_electrical: boolean;
  pdf_width_pts?: number;
  pdf_height_pts?: number;
}

export interface ProjectSummary {
  project_id: string;
  name: string;
  filename: string;
  filepath: string;
  is_sample?: boolean;
  description?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FixStage = "1st Fix" | "2nd Fix" | "Communals" | "Specialist";

export interface LegendItem {
  legend_id: string;
  label: string;
  color: string;
  category: string;
  fix_stage: FixStage;
  manufacturer: string;
  part_code: string;
  template_crop_coords?: Rect;
  template_image_b64?: string;
  count?: number;
}

export type MarkerStatus =
  | "ai_unverified"
  | "ai_verified"
  | "user_verified"
  | "needs_review"
  | "manual_added"
  | "possible_missed";

export interface Marker extends Rect {
  marker_id: string;
  legend_id: string;
  confidence_score: number;
  angle?: number;
  status: MarkerStatus;
  room: string;
  page_index: number;
  page_number: number;
  metadata?: Record<string, unknown>;
}

export interface RoomZone extends Rect {
  name: string;
  page_index?: number;
}

export interface ExcludedZone extends Rect {
  label?: string;
}

export interface ProjectDetails extends ProjectSummary {
  total_pages: number;
  pages: PageMeta[];
  legends: LegendItem[];
  markers: Marker[];
  rooms: RoomZone[];
  excluded_zones?: Record<string, ExcludedZone[]>;
}

export interface LibrarySymbol {
  symbol_id?: string;
  legend_id?: string;
  cad_label?: string;
  cad_abbreviation?: string;
  sheet_row?: number;
  sheet_desc?: string;
  manufacturer?: string;
  part_code?: string;
  unit_price?: number;
  category?: string;
  fix_stage?: FixStage;
  box_type?: string;
  cable_per_point_m?: number;
  cable_type?: string;
  label?: string;
  color?: string;
  template_crop_coords?: Rect;
  template_image_b64?: string;
  [key: string]: unknown;
}

export interface Verification {
  marker_id: string;
  is_valid: boolean;
  confidence: number;
  reason: string;
  suggested_reclassification?: string;
}

export interface AuditLog {
  [key: string]: unknown;
}

export type Tool = "select" | "add" | "crop" | "exclude" | "room";
export type ReviewFilter = "open" | "ai" | "approved" | "all";
export type ThemePref = "system" | "light" | "dark";
export type CanvasMode = "paper" | "blueprint";

export const APPROVED: MarkerStatus[] = ["user_verified", "manual_added"];
export const OPEN: MarkerStatus[] = ["needs_review", "ai_unverified", "possible_missed"];

export interface SheetInfo {
  page_index: number;
  page_number: number;
  title: string;
  verdict: "yes" | "maybe" | "no";
  legend_hits: number;
  reasons: string[];
}

export interface HouseType {
  project_id: string;
  name: string;
  filename: string;
  filepath: string;
  rel_path: string;
  total_pages: number;
  electrical_pages: { page_index: number; page_number: number; title: string }[];
  plots: number;
  plots_source?: { file?: string; matched?: string[]; manual?: boolean } | null;
  sheets?: SheetInfo[];
  sheets_confirmed?: boolean;
}

export interface AIRun {
  checked: number;
  kept: number;
  removed: number;
  calls: number;
  skipped: number;
  error: string | null;
  cost?: number;
  marks_sent?: number;
  at?: string;
}

export interface AIEstimate {
  marks: number;
  available: number;
  calls: number;
  cost_per_call: number;
  estimated_cost: number;
  basis: string;
  by_house_type: Record<string, number>;
}

export interface CostSummary {
  total: number;
  today: number;
  calls: number;
  tokens: { input: number; output: number };
  by_day: { day: string; cost: number }[];
  by_tender: { tag: string; name: string; cost: number; calls: number }[];
  recent: { ts: number; model: string; tag: string; input_tokens: number; output_tokens: number; cost: number }[];
  prices: Record<string, [number, number]>;
  cost_per_call: number;
  estimate_basis: string;
}

export interface RunSettings {
  use_ai: boolean;
  ai_mode?: "auto" | "manual";
  auto_high: number;
  ai_low: number;
  min_keep: number;
  max_ai_marks: number;
  quick: boolean;
  resume?: boolean;
  api_key?: string | null;
}

export interface Tender {
  tender_id: string;
  name: string;
  created_at: string;
  status: "uploaded" | "running" | "done" | "failed";
  house_types: HouseType[];
  documents: { path: string; kind: string; pages?: number; error?: string; filepath?: string; sheets?: SheetInfo[]; maybe?: number }[];
  progress: {
    stage: string; message: string; done: number; total: number; started_at?: number; ai_only?: boolean;
    sheets_done?: number; sheets_total?: number; marks_found?: number; current?: string; stopped?: boolean; interrupted?: boolean;
  };
  sheet_state?: Record<string, "pending" | "running" | "done">;
  ai_progress?: { running: boolean; done: number; total: number; message: string; failed?: boolean } | null;
  cancel?: boolean;
  schedule?: { file: string; sheet: string; total: number; plots: Record<string, number>; unmatched: Record<string, number> } | null;
  ai_runs?: AIRun[];
  legend_entries_removed?: number;
  layer_check?: { confirmed: number; down: number; possible_missed: number };
  settings: RunSettings;
  ai?: AIRun | null;
  duration_s?: number;
  finished_at?: string;
}

export interface TenderHouseMarks {
  project_id: string;
  name: string;
  filepath: string;
  plots: number;
  electrical_pages: HouseType["electrical_pages"];
  legends: LegendItem[];
  markers: Marker[];
}
