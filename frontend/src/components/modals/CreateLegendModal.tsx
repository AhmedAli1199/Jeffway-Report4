import React, { useState } from "react";
import { X, Sparkles, Check } from "lucide-react";
import type { LegendItem } from "../../types/takeoff";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cropCoords: { x: number; y: number; width: number; height: number };
  cropImageB64?: string;
  onSaveAndRun: (legend: LegendItem, runAI: boolean) => void;
  isProcessing?: boolean;
  initialLegend?: LegendItem | null;
}

const COLOR_PRESETS = [
  "#EF4444", // Red
  "#3B82F6", // Blue
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#F97316", // Orange
];

export const CreateLegendModal: React.FC<Props> = ({
  isOpen,
  onClose,
  cropCoords,
  cropImageB64,
  onSaveAndRun,
  isProcessing,
  initialLegend,
}) => {
  const [label, setLabel] = useState(initialLegend?.label || "");
  const [category, setCategory] = useState(initialLegend?.category || "Power & Accessories");
  const [fixStage, setFixStage] = useState<"1st Fix" | "2nd Fix" | "Communals" | "Specialist">(
    initialLegend?.fix_stage || "2nd Fix"
  );
  const [manufacturer, setManufacturer] = useState(initialLegend?.manufacturer || "Deta");
  const [partCode, setPartCode] = useState(initialLegend?.part_code || "Slimline Standard");
  const [color, setColor] = useState(initialLegend?.color || COLOR_PRESETS[0]);

  React.useEffect(() => {
    if (isOpen) {
      if (initialLegend) {
        setLabel(initialLegend.label || "");
        setCategory(initialLegend.category || "Power & Accessories");
        setFixStage(initialLegend.fix_stage || "2nd Fix");
        setManufacturer(initialLegend.manufacturer || "Deta");
        setPartCode(initialLegend.part_code || "Slimline Standard");
        setColor(initialLegend.color || COLOR_PRESETS[0]);
      } else {
        setLabel("");
        setColor(COLOR_PRESETS[0]);
      }
    }
  }, [isOpen, initialLegend]);

  if (!isOpen) return null;

  const handleSubmit = (runAI: boolean) => {
    if (!label.trim()) return;
    const newLegend: LegendItem = {
      ...(initialLegend || {}),
      legend_id: initialLegend?.legend_id || `leg_${Date.now()}`,
      label: label.trim(),
      color,
      category,
      fix_stage: fixStage,
      manufacturer,
      part_code: partCode,
      template_crop_coords: cropCoords,
      template_image_b64: cropImageB64,
    };
    onSaveAndRun(newLegend, runAI);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: color,
              }}
            />
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>
              {initialLegend ? `Update Symbol Icon: ${initialLegend.label}` : "Define Symbol Template"}
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94A3B8",
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {initialLegend && (
            <div
              style={{
                background: "rgba(59, 130, 246, 0.12)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                borderRadius: 6,
                padding: "8px 12px",
                marginBottom: 12,
                fontSize: 11,
                color: "#93C5FD",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Sparkles size={14} color="#60A5FA" style={{ flexShrink: 0 }} />
              <span>
                Updating visual icon for <strong>{initialLegend.label}</strong>. Underlying tender sheet mappings (
                <strong>{initialLegend.fix_stage}</strong> • <strong>{initialLegend.manufacturer}</strong> •{" "}
                <strong>{initialLegend.part_code}</strong>) are preserved.
              </span>
            </div>
          )}

          {cropImageB64 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                background: "#0F172A",
                padding: 12,
                borderRadius: 8,
                border: "1px dashed #334155",
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  background: "#fff",
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <img
                  src={cropImageB64}
                  alt="Symbol Crop"
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              </div>
              <span style={{ fontSize: 10, color: "#64748B", fontFamily: "monospace" }}>
                Crop: {Math.round(cropCoords.width)} × {Math.round(cropCoords.height)} px
              </span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Symbol Label / Description *</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. 13A Switched Double Socket, Recessed Downlight"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="form-group">
              <label className="form-label">Fix Stage</label>
              <select
                className="form-select"
                value={fixStage}
                onChange={(e) => setFixStage(e.target.value as any)}
              >
                <option value="1st Fix">1st Fix (Back Boxes / Cable)</option>
                <option value="2nd Fix">2nd Fix (Accessories / Plates)</option>
                <option value="Communals">Communals</option>
                <option value="Specialist">Specialist / Extra</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Manufacturer</label>
              <input
                type="text"
                className="form-input"
                placeholder="Deta / Aico / BG"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Marker Color</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    backgroundColor: c,
                    border: color === c ? "2px solid #FFFFFF" : "1px solid rgba(255,255,255,0.2)",
                    cursor: "pointer",
                    boxShadow: color === c ? `0 0 10px ${c}` : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {color === c && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleSubmit(false)}
              disabled={!label.trim() || isProcessing}
              style={{ background: "#1E293B", color: "#F8FAFC", border: "1px solid #475569", display: "flex", alignItems: "center", gap: 6 }}
            >
              <Check size={14} />
              <span>Save Crop Only</span>
            </button>
            <button
              className="btn-primary"
              onClick={() => handleSubmit(true)}
              disabled={!label.trim() || isProcessing}
              style={{ minWidth: 160 }}
            >
              <Sparkles size={15} />
              <span>{isProcessing ? "Scanning Floor Plan..." : "Save & Run AI Auto-Count"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
