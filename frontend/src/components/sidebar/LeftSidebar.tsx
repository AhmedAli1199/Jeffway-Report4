import React, { useState } from "react";
import type { PageMeta, LegendItem, Marker } from "../../types/takeoff";
import { Layers, Sparkles, Trash2, Crop } from "lucide-react";
import { api } from "../../services/api";

interface Props {
  pages: PageMeta[];
  currentPageIndex: number;
  onSelectPage: (index: number) => void;
  filepath: string;
  legends: LegendItem[];
  selectedLegendId?: string;
  onSelectLegend: (legendId: string) => void;
  onDeleteLegend: (legendId: string) => void;
  onRecropLegend?: (legend: LegendItem) => void;
  onAddPresetLegend: (label: string, category: string, fixStage: any, color: string) => void;
  onScanLegendAI: () => void;
  markers: Marker[];
  isScanningAI?: boolean;
}

export const LeftSidebar: React.FC<Props> = ({
  pages,
  currentPageIndex,
  onSelectPage,
  filepath,
  legends,
  selectedLegendId,
  onSelectLegend,
  onDeleteLegend,
  onRecropLegend,
  onAddPresetLegend,
  onScanLegendAI,
  markers,
  isScanningAI,
}) => {
  const [activeTab, setActiveTab] = useState<"sheets" | "legend">("sheets");
  const [filterElectrical, setFilterElectrical] = useState(true);

  const displayedPages = filterElectrical
    ? pages.filter((p) => p.is_electrical)
    : pages;

  // Compute live count per legend
  const countsByLegend = React.useMemo(() => {
    const counts: Record<string, number> = {};
    markers.forEach((m) => {
      counts[m.legend_id] = (counts[m.legend_id] || 0) + 1;
    });
    return counts;
  }, [markers]);

  return (
    <div className="left-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">
          <Layers size={14} color="#3B82F6" />
          Project Navigator
        </span>
      </div>

      <div className="sidebar-tabs">
        <div
          className={`sidebar-tab ${activeTab === "sheets" ? "active" : ""}`}
          onClick={() => setActiveTab("sheets")}
        >
          Drawing Sheets ({pages.length})
        </div>
        <div
          className={`sidebar-tab ${activeTab === "legend" ? "active" : ""}`}
          onClick={() => setActiveTab("legend")}
        >
          Symbol Legend ({legends.length})
        </div>
      </div>

      {activeTab === "sheets" && (
        <>
          <div style={{ padding: "0 14px 8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#94A3B8" }}>
              Filter Electrical Plans
            </span>
            <button
              onClick={() => setFilterElectrical(!filterElectrical)}
              style={{
                background: filterElectrical ? "rgba(16, 185, 129, 0.15)" : "#1E293B",
                color: filterElectrical ? "#10B981" : "#94A3B8",
                border: "1px solid",
                borderColor: filterElectrical ? "rgba(16, 185, 129, 0.4)" : "#334155",
                borderRadius: 20,
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              {filterElectrical ? "Electrical Only" : "All Sheets"}
            </button>
          </div>

          <div className="page-list">
            {displayedPages.map((p) => {
              const isActive = p.page_index === currentPageIndex;
              const thumbUrl = api.getThumbnailUrl(filepath, p.page_index);

              return (
                <div
                  key={p.page_index}
                  className={`page-card ${isActive ? "active" : ""}`}
                  onClick={() => onSelectPage(p.page_index)}
                >
                  <div className="page-thumb-preview">
                    <img src={thumbUrl} alt={`P${p.page_number}`} loading="lazy" />
                  </div>
                  <div className="page-info">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="page-title-text">{p.title}</span>
                      {p.is_electrical && (
                        <span className="page-badge-elec">M&E</span>
                      )}
                    </div>
                    <div className="page-drawing-no">
                      Sheet {p.page_number} {p.drawing_no ? `• ${p.drawing_no}` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {activeTab === "legend" && (
        <>
          <div style={{ padding: "0 14px 8px 14px", display: "flex", gap: 8 }}>
            <button
              className="btn-primary"
              style={{ flex: 1, padding: "6px 10px", fontSize: 11 }}
              onClick={onScanLegendAI}
              disabled={isScanningAI}
            >
              <Sparkles size={13} />
              <span>{isScanningAI ? "Reading Legend..." : "AI Auto-Scan Legend"}</span>
            </button>
          </div>

          <div className="legend-list">
            {legends.map((leg) => {
              const isSelected = leg.legend_id === selectedLegendId;
              const count = countsByLegend[leg.legend_id] || 0;

              return (
                <div
                  key={leg.legend_id}
                  className={`legend-card ${isSelected ? "selected" : ""}`}
                  onClick={() => onSelectLegend(leg.legend_id)}
                >
                  <div className="legend-card-header">
                    <div
                      className="legend-color-dot"
                      style={{ backgroundColor: leg.color }}
                    />
                    {leg.template_image_b64 ? (
                      <div className="legend-crop-thumb">
                        <img src={leg.template_image_b64} alt={leg.label} />
                      </div>
                    ) : (
                      <div
                        className="legend-crop-thumb"
                        style={{ backgroundColor: "#1E293B", color: leg.color, fontSize: 11, fontWeight: 700 }}
                      >
                        {leg.label.charAt(0)}
                      </div>
                    )}
                    <div className="legend-label-col">
                      <div className="legend-name" title={leg.label}>
                        {leg.label}
                      </div>
                      <div className="legend-fix-tag">
                        {leg.fix_stage} • {leg.manufacturer}
                      </div>
                    </div>
                    <div className="legend-count-pill">{count}</div>
                  </div>

                  <div className="legend-actions-row">
                    <span style={{ fontSize: 10, color: "#64748B" }}>
                      {isSelected ? "Active Placement Symbol" : "Click to select"}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onRecropLegend) onRecropLegend(leg);
                        }}
                        style={{
                          background: "rgba(59, 130, 246, 0.15)",
                          border: "1px solid rgba(59, 130, 246, 0.35)",
                          color: "#60A5FA",
                          cursor: "pointer",
                          padding: "2px 6px",
                          borderRadius: 4,
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                        title={`Select / re-crop icon from blueprint for ${leg.label}`}
                      >
                        <Crop size={11} />
                        <span>Re-crop</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteLegend(leg.legend_id);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#64748B",
                          cursor: "pointer",
                          padding: 2,
                        }}
                        title="Delete Template"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Quick Presets Section */}
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>
                BS 7671 Standard Presets
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                {[
                  { label: "13A Double Socket", fix: "2nd Fix", color: "#EF4444" },
                  { label: "Pendant Light", fix: "2nd Fix", color: "#3B82F6" },
                  { label: "Downlighter (R)", fix: "2nd Fix", color: "#10B981" },
                  { label: "Smoke Detector (S)", fix: "2nd Fix", color: "#F59E0B" },
                  { label: "Extract Fan (F)", fix: "2nd Fix", color: "#8B5CF6" },
                  { label: "EV Charger Point", fix: "Specialist", color: "#06B6D4" },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => onAddPresetLegend(item.label, "Power", item.fix, item.color)}
                    style={{
                      background: "#1E293B",
                      border: "1px solid #334155",
                      borderRadius: 6,
                      padding: "5px 8px",
                      color: "#F8FAFC",
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: item.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
