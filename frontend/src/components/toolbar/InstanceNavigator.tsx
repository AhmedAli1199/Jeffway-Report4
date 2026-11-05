import React from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  AlertTriangle, 
  CheckCircle2, 
  Layers, 
  ShieldCheck, 
  Trash2,
  Zap
} from "lucide-react";
import type { Marker, LegendItem } from "../../types/takeoff";

interface Props {
  markers: Marker[];
  legends?: LegendItem[];
  currentMarkerId?: string | null;
  filterMode: "review" | "ai" | "high" | "all";
  onSelectFilterMode: (mode: "review" | "ai" | "high" | "all") => void;
  onJumpToMarker: (marker: Marker) => void;
  onApproveMarker: (markerId: string) => void;
  onDeleteMarker: (markerId: string) => void;
  selectedLegendId?: string;
  selectedLegendLabel?: string;
  selectedLegendColor?: string;
  onSelectLegendId?: (id: string) => void;
  confidenceThreshold?: number;
  onRunFirstPassForSelected?: () => void;
  isProcessingAI?: boolean;
}

export const InstanceNavigator: React.FC<Props> = ({
  markers,
  legends = [],
  currentMarkerId,
  filterMode,
  onSelectFilterMode,
  onJumpToMarker,
  onApproveMarker,
  onDeleteMarker,
  selectedLegendId,
  selectedLegendLabel,
  selectedLegendColor,
  onSelectLegendId,
  confidenceThreshold = 0.55,
  onRunFirstPassForSelected,
  isProcessingAI,
}) => {
  // Resolve effective selected legend: ensure it always points to a real legend
  const effectiveLegendId = React.useMemo(() => {
    if (selectedLegendId && legends.some((l) => l.legend_id === selectedLegendId)) {
      return selectedLegendId;
    }
    return legends[0]?.legend_id || selectedLegendId || "";
  }, [selectedLegendId, legends]);

  // Keep parent in sync if selectedLegendId was pointing to an old or nonexistent id
  React.useEffect(() => {
    if (effectiveLegendId && effectiveLegendId !== selectedLegendId && onSelectLegendId) {
      onSelectLegendId(effectiveLegendId);
    }
  }, [effectiveLegendId, selectedLegendId, onSelectLegendId]);

  // Filter instances strictly for the selected active symbol and real-time confidence threshold
  const symbolMarkers = React.useMemo(() => {
    return markers.filter((m) => {
      if (effectiveLegendId && m.legend_id !== effectiveLegendId) return false;
      if (m.status === "user_verified" || m.status === "ai_verified" || m.status === "manual_added") {
        return true;
      }
      return m.confidence_score === undefined || m.confidence_score === null || m.confidence_score >= confidenceThreshold;
    });
  }, [markers, effectiveLegendId, confidenceThreshold]);

  const filteredList = React.useMemo(() => {
    if (filterMode === "review") {
      const list = symbolMarkers.filter((m) => m.status === "needs_review");
      // If there are no needs_review candidates, fall back to ai_unverified so user can inspect
      if (list.length === 0 && symbolMarkers.some((m) => m.status === "ai_unverified")) {
        return symbolMarkers.filter((m) => m.status === "ai_unverified");
      }
      return list;
    } else if (filterMode === "ai") {
      return symbolMarkers.filter((m) => m.status === "ai_verified");
    } else if (filterMode === "high") {
      return symbolMarkers.filter((m) => m.status === "ai_unverified");
    }
    return symbolMarkers;
  }, [symbolMarkers, filterMode]);

  // Auto-jump to first candidate in filteredList if currentMarkerId is not set or not in list
  React.useEffect(() => {
    if (filteredList.length > 0) {
      if (!currentMarkerId || !filteredList.some((m) => m.marker_id === currentMarkerId)) {
        onJumpToMarker(filteredList[0]);
      }
    }
  }, [filteredList, currentMarkerId, onJumpToMarker]);

  const currentIndex = React.useMemo(() => {
    if (!currentMarkerId || filteredList.length === 0) return -1;
    return filteredList.findIndex((m) => m.marker_id === currentMarkerId);
  }, [filteredList, currentMarkerId]);

  const activeMarker = currentIndex >= 0 ? filteredList[currentIndex] : null;

  const handleNext = () => {
    if (filteredList.length === 0) return;
    const nextIdx = (currentIndex + 1) % filteredList.length;
    onJumpToMarker(filteredList[nextIdx]);
  };

  const handlePrev = () => {
    if (filteredList.length === 0) return;
    const prevIdx = (currentIndex - 1 + filteredList.length) % filteredList.length;
    onJumpToMarker(filteredList[prevIdx]);
  };

  // Scoped count stats for active symbol
  const reviewCount = symbolMarkers.filter((m) => m.status === "needs_review").length;
  const aiCount = symbolMarkers.filter((m) => m.status === "ai_verified").length;
  const highCount = symbolMarkers.filter((m) => m.status === "ai_unverified").length;
  const totalSymbolCount = symbolMarkers.length;

  return (
    <div
      style={{
        position: "absolute",
        top: 68,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(17, 24, 39, 0.94)",
        backdropFilter: "blur(14px)",
        border: "1px solid #334155",
        borderRadius: 24,
        padding: "5px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.6)",
        zIndex: 40,
        fontSize: 12,
        maxWidth: "92vw",
      }}
    >
      {/* Symbol Switcher Dropdown */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            backgroundColor: selectedLegendColor || "#3B82F6",
            flexShrink: 0,
          }}
        />
        {legends.length > 0 && onSelectLegendId ? (
          <select
            value={effectiveLegendId}
            onChange={(e) => onSelectLegendId(e.target.value)}
            style={{
              background: "#1E293B",
              color: "#F8FAFC",
              border: "1px solid #475569",
              borderRadius: 12,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              outline: "none",
              maxWidth: 180,
            }}
            title="Switch between takeoff symbols"
          >
            {legends.map((l) => {
              const total = markers.filter((m) => m.legend_id === l.legend_id).length;
              const active = markers.filter((m) => {
                if (m.legend_id !== l.legend_id) return false;
                if (m.status === "user_verified" || m.status === "ai_verified" || m.status === "manual_added") return true;
                return m.confidence_score === undefined || m.confidence_score === null || m.confidence_score >= confidenceThreshold;
              }).length;
              const countStr = active === total ? `${active}` : `${active} of ${total}`;
              return (
                <option key={l.legend_id} value={l.legend_id}>
                  {l.label} ({countStr})
                </option>
              );
            })}
          </select>
        ) : (
          <span style={{ fontWeight: 700, color: "#F8FAFC", fontSize: 11, whiteSpace: "nowrap" }}>
            {selectedLegendLabel || "Symbol"}
          </span>
        )}
      </div>

      <div style={{ width: 1, height: 18, background: "#334155" }} />

      {/* Category Pills */}
      <div style={{ display: "flex", background: "#1E293B", borderRadius: 16, padding: 2 }}>
        <button
          onClick={() => onSelectFilterMode("review")}
          style={{
            background: filterMode === "review" ? "#F59E0B" : "transparent",
            color: filterMode === "review" ? "#0F172A" : "#F59E0B",
            fontWeight: 700,
            fontSize: 10,
            border: "none",
            borderRadius: 14,
            padding: "3px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Zoom through symbols that need estimator review"
        >
          <AlertTriangle size={11} />
          <span>Review ({reviewCount})</span>
        </button>

        <button
          onClick={() => onSelectFilterMode("ai")}
          style={{
            background: filterMode === "ai" ? "#8B5CF6" : "transparent",
            color: filterMode === "ai" ? "#FFFFFF" : "#A78BFA",
            fontWeight: 700,
            fontSize: 10,
            border: "none",
            borderRadius: 14,
            padding: "3px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Zoom through symbols confirmed by AI, awaiting your sign-off"
        >
          <CheckCircle2 size={11} />
          <span>AI Confirmed ({aiCount})</span>
        </button>

        <button
          onClick={() => onSelectFilterMode("high")}
          style={{
            background: filterMode === "high" ? "#10B981" : "transparent",
            color: filterMode === "high" ? "#FFFFFF" : "#10B981",
            fontWeight: 700,
            fontSize: 10,
            border: "none",
            borderRadius: 14,
            padding: "3px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Zoom through high confidence symbols"
        >
          <span>High ({highCount})</span>
        </button>

        <button
          onClick={() => onSelectFilterMode("all")}
          style={{
            background: filterMode === "all" ? "#3B82F6" : "transparent",
            color: filterMode === "all" ? "#FFFFFF" : "#94A3B8",
            fontWeight: 700,
            fontSize: 10,
            border: "none",
            borderRadius: 14,
            padding: "3px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Zoom through all candidates for this symbol"
        >
          <Layers size={11} />
          <span>All ({totalSymbolCount})</span>
        </button>
      </div>

      <div style={{ width: 1, height: 18, background: "#334155" }} />

      {/* Instance Navigation Arrows */}
      <button
        onClick={handlePrev}
        disabled={filteredList.length === 0}
        style={{
          background: "#1E293B",
          border: "1px solid #334155",
          color: "#F8FAFC",
          borderRadius: "50%",
          width: 26,
          height: 26,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: filteredList.length > 0 ? "pointer" : "default",
          opacity: filteredList.length > 0 ? 1 : 0.4,
        }}
        title="Previous Symbol (Left Arrow)"
      >
        <ChevronLeft size={16} />
      </button>

      <span style={{ fontSize: 11, fontWeight: 700, color: "#F8FAFC", fontFamily: "JetBrains Mono", minWidth: 70, textAlign: "center" }}>
        {filteredList.length === 0
          ? "0 / 0"
          : `${currentIndex + 1} of ${filteredList.length}`}
      </span>

      <button
        onClick={handleNext}
        disabled={filteredList.length === 0}
        style={{
          background: "#1E293B",
          border: "1px solid #334155",
          color: "#F8FAFC",
          borderRadius: "50%",
          width: 26,
          height: 26,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: filteredList.length > 0 ? "pointer" : "default",
          opacity: filteredList.length > 0 ? 1 : 0.4,
        }}
        title="Next Symbol (Right Arrow)"
      >
        <ChevronRight size={16} />
      </button>

      {/* Quick Approval / Rejection buttons right on the bar */}
      {activeMarker && (
        <>
          <div style={{ width: 1, height: 18, background: "#334155" }} />
          <button
            onClick={() => onApproveMarker(activeMarker.marker_id)}
            style={{
              background: "#10B981",
              border: "none",
              color: "#FFFFFF",
              borderRadius: 14,
              padding: "3px 8px",
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Approve symbol (Shortcut: A)"
          >
            <ShieldCheck size={12} />
            <span>Approve (A)</span>
          </button>

          <button
            onClick={() => onDeleteMarker(activeMarker.marker_id)}
            style={{
              background: "rgba(239, 68, 68, 0.2)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#EF4444",
              borderRadius: 14,
              padding: "3px 8px",
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Delete symbol (Shortcut: Del)"
          >
            <Trash2 size={12} />
            <span>Delete (Del)</span>
          </button>
        </>
      )}

      {/* Option to run / re-run 1st-Pass AI Count directly on active symbol */}
      {onRunFirstPassForSelected && (
        <>
          <div style={{ width: 1, height: 18, background: "#334155" }} />
          <button
            onClick={onRunFirstPassForSelected}
            disabled={isProcessingAI}
            style={{
              background: totalSymbolCount === 0 ? "linear-gradient(135deg, #2563EB, #1D4ED8)" : "#1E293B",
              border: "1px solid",
              borderColor: totalSymbolCount === 0 ? "#3B82F6" : "#334155",
              color: totalSymbolCount === 0 ? "#FFFFFF" : "#94A3B8",
              borderRadius: 14,
              padding: "3px 9px",
              fontSize: 10,
              fontWeight: 700,
              cursor: isProcessingAI ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
            }}
            title={`Run 1st-Pass AI Auto-Count for ${selectedLegendLabel || "selected symbol"}`}
          >
            <Zap size={12} color={totalSymbolCount === 0 ? "#FFFFFF" : "#60A5FA"} />
            <span>{totalSymbolCount === 0 ? "Run 1st-Pass AI Count" : "Re-Run AI"}</span>
          </button>
        </>
      )}
    </div>
  );
};
