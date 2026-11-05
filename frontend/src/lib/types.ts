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
  | "manual_added";

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
export const OPEN: MarkerStatus[] = ["needs_review", "ai_unverified"];
