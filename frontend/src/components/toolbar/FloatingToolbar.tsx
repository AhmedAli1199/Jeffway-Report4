import React from "react";
import { Hand, Crop, PlusCircle, Ruler, ZoomIn, ZoomOut, Maximize2, Trash2, Ban, Sparkles } from "lucide-react";
import type { ToolMode } from "../../types/takeoff";

interface Props {
  activeTool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  selectedLegendLabel?: string;
  selectedLegendColor?: string;
  onDeleteSelectedMarker?: () => void;
  hasSelectedMarker?: boolean;
  hasExcludedZone?: boolean;
  onClearExcludedZone?: () => void;
  onAutoDetectLegend?: () => void;
}

export const FloatingToolbar: React.FC<Props> = ({
  activeTool,
  onSelectTool,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  selectedLegendLabel,
  selectedLegendColor,
  onDeleteSelectedMarker,
  hasSelectedMarker,
  hasExcludedZone,
  onClearExcludedZone,
  onAutoDetectLegend,
}) => {
  return (
    <div className="floating-toolbar">
      <button
        className={`toolbar-btn ${activeTool === "pan" ? "active" : ""}`}
        onClick={() => onSelectTool("pan")}
        title="Pan Workspace (Spacebar + Drag)"
      >
        <Hand size={16} />
        <span>Pan</span>
      </button>

      <button
        className={`toolbar-btn ${activeTool === "crop_legend" ? "active" : ""}`}
        onClick={() => onSelectTool("crop_legend")}
        title="Drag a box to crop a symbol template from legend or sheet"
      >
        <Crop size={16} />
        <span>Crop Symbol</span>
      </button>

      <button
        className={`toolbar-btn ${activeTool === "exclude_zone" ? "active" : ""}`}
        onClick={() => onSelectTool(activeTool === "exclude_zone" ? "pan" : "exclude_zone")}
        title="Draw an exclusion box by hand around the legend table so symbols inside are never counted"
        style={{
          color: activeTool === "exclude_zone" ? "#EF4444" : undefined,
          backgroundColor: activeTool === "exclude_zone" ? "rgba(239, 68, 68, 0.15)" : undefined,
          borderColor: activeTool === "exclude_zone" ? "#EF4444" : undefined,
        }}
      >
        <Ban size={16} />
        <span>Exclude Legend (Manual)</span>
      </button>

      {onAutoDetectLegend && (
        <button
          className="toolbar-btn"
          onClick={onAutoDetectLegend}
          title="Auto-detect Electrical Legend boundaries"
          style={{ color: "#38BDF8" }}
        >
          <Sparkles size={16} />
          <span>Auto-Detect</span>
        </button>
      )}

      {hasExcludedZone && onClearExcludedZone && (
        <button
          className="toolbar-btn"
          onClick={onClearExcludedZone}
          title="Remove exclusion zone for this sheet"
          style={{ fontSize: 11, color: "#F87171" }}
        >
          <Trash2 size={15} />
          <span>Clear Exclude</span>
        </button>
      )}

      <button
        className={`toolbar-btn ${activeTool === "manual_add" ? "active" : ""}`}
        onClick={() => onSelectTool("manual_add")}
        title={selectedLegendLabel ? `Click canvas to place ${selectedLegendLabel}` : "Select a symbol first to add manually"}
      >
        <PlusCircle size={16} />
        <span>Add Pin</span>
        {selectedLegendColor && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: selectedLegendColor,
              display: "inline-block",
            }}
          />
        )}
      </button>

      <button
        className={`toolbar-btn ${activeTool === "measure" ? "active" : ""}`}
        onClick={() => onSelectTool("measure")}
        title="Measure distance or scale calibration"
      >
        <Ruler size={16} />
        <span>Scale / Ruler</span>
      </button>

      <div className="toolbar-divider" />

      <button className="toolbar-btn" onClick={onZoomIn} title="Zoom In (+)">
        <ZoomIn size={16} />
      </button>

      <button className="toolbar-btn" onClick={onZoomOut} title="Zoom Out (-)">
        <ZoomOut size={16} />
      </button>

      <button className="toolbar-btn" onClick={onResetZoom} title="Fit to Screen">
        <Maximize2 size={16} />
      </button>

      {hasSelectedMarker && (
        <>
          <div className="toolbar-divider" />
          <button
            className="toolbar-btn"
            style={{ color: "#EF4444" }}
            onClick={onDeleteSelectedMarker}
            title="Delete Selected Pin"
          >
            <Trash2 size={16} />
            <span>Delete</span>
          </button>
        </>
      )}
    </div>
  );
};
