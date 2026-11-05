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

export interface Project {
  project_id: string;
  name: string;
  filename: string;
  filepath: string;
  total_pages: number;
  pages: PageMeta[];
  is_sample?: boolean;
  description?: string;
}

export interface LegendItem {
  legend_id: string;
  label: string;
  color: string;
  category: string;
  fix_stage: "1st Fix" | "2nd Fix" | "Communals" | "Specialist";
  manufacturer: string;
  part_code: string;
  template_crop_coords?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  template_image_b64?: string;
  count?: number;
}

export interface Marker {
  marker_id: string;
  legend_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence_score: number;
  angle?: number;
  status: "ai_unverified" | "ai_verified" | "user_verified" | "needs_review" | "manual_added";
  room: string;
  page_index: number;
  page_number: number;
  metadata?: Record<string, any>;
}

export interface RoomZone {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExcludedZone {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export type ToolMode = "pan" | "crop_legend" | "manual_add" | "measure" | "delete" | "exclude_zone";
