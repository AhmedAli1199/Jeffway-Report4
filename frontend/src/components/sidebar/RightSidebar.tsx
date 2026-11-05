import React, { useState } from "react";
import type { LegendItem, Marker, RoomZone } from "../../types/takeoff";
import { 
  FileSpreadsheet, 
  FileDown, 
  ShieldCheck, 
  Sparkles,
  Save,
  RotateCcw,
  CheckCheck,
  Zap,
  BookOpen,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  Layers
} from "lucide-react";

interface Props {
  legends: LegendItem[];
  markers: Marker[];
  confidenceThreshold: number;
  onThresholdChange: (value: number) => void;
  onBatchApproveHighConfidence: () => void;
  onBatchApproveAIVerified?: () => void;
  onRunAIAudit?: () => void;
  isAuditingAI?: boolean;
  onExportExcel: () => void;
  onExportPdf: () => void;
  onDetectRoomsAI: () => void;
  rooms: RoomZone[];
  isDetectingRooms?: boolean;
  selectedLegend?: LegendItem | null;
  onSelectLegendId?: (legendId: string) => void;
  onClearCandidatesForLegend?: (legendId: string) => void;
  onApproveAllForLegend?: (legendId: string) => void;
  lastSavedTime?: string | null;
  isSaving?: boolean;
  onSaveSession?: () => void;
  onRunFirstPassForSelected?: () => void;
  isProcessingAI?: boolean;
  onExportMasterTender?: () => void;
  onOpenSymbolLibrary?: () => void;
}

export const RightSidebar: React.FC<Props> = ({
  legends,
  markers,
  confidenceThreshold,
  onThresholdChange,
  onBatchApproveHighConfidence,
  onBatchApproveAIVerified,
  onRunAIAudit,
  isAuditingAI,
  onExportExcel,
  onExportPdf,
  onDetectRoomsAI,
  rooms,
  isDetectingRooms,
  selectedLegend,
  onSelectLegendId,
  onClearCandidatesForLegend,
  onApproveAllForLegend,
  lastSavedTime,
  isSaving,
  onSaveSession,
  onRunFirstPassForSelected,
  isProcessingAI,
  onExportMasterTender,
  onOpenSymbolLibrary,
}) => {
  const [activeTab, setActiveTab] = useState<"tally" | "rooms">("tally");
  const [stageFilter, setStageFilter] = useState<string>("All");
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isQcCollapsed, setIsQcCollapsed] = useState<boolean>(false);

  // Overall project stage counts for 1st Fix, 2nd Fix, Specialist
  const stageStats = React.useMemo(() => {
    const counts: Record<string, number> = {};
    markers.forEach((m) => {
      if (
        m.status === "manual_added" || 
        m.status === "user_verified" || 
        m.status === "ai_verified" || 
        (m.confidence_score !== undefined && m.confidence_score !== null && m.confidence_score >= confidenceThreshold)
      ) {
        counts[m.legend_id] = (counts[m.legend_id] || 0) + 1;
      }
    });

    let firstFix = 0;
    let secondFix = 0;
    let specialist = 0;
    let other = 0;

    legends.forEach((l) => {
      const cnt = counts[l.legend_id] || 0;
      const stage = (l.fix_stage || "").toLowerCase();
      if (stage.includes("1st")) firstFix += cnt;
      else if (stage.includes("2nd")) secondFix += cnt;
      else if (stage.includes("spec")) specialist += cnt;
      else other += cnt;
    });

    return {
      firstFix,
      secondFix,
      specialist,
      other,
      total: firstFix + secondFix + specialist + other,
    };
  }, [legends, markers, confidenceThreshold]);

  // Resolve effective selected legend
  const effectiveLegend = React.useMemo(() => {
    if (selectedLegend && legends.some((l) => l.legend_id === selectedLegend.legend_id)) {
      return selectedLegend;
    }
    return legends[0] || selectedLegend || null;
  }, [selectedLegend, legends]);

  // Keep parent in sync if selectedLegend was out of sync
  React.useEffect(() => {
    if (effectiveLegend && effectiveLegend.legend_id !== selectedLegend?.legend_id && onSelectLegendId) {
      onSelectLegendId(effectiveLegend.legend_id);
    }
  }, [effectiveLegend, selectedLegend, onSelectLegendId]);

  // Scoped metrics for the active selected symbol with real-time confidence filtering
  const activeMarkers = React.useMemo(() => {
    return markers.filter((m) => {
      if (effectiveLegend && m.legend_id !== effectiveLegend.legend_id) return false;
      // Confirmed / manual / AI-verified items are always kept
      if (m.status === "user_verified" || m.status === "manual_added" || m.status === "ai_verified") return true;
      // Candidates must satisfy confidenceThreshold in real time
      return m.confidence_score === undefined || m.confidence_score === null || m.confidence_score >= confidenceThreshold;
    });
  }, [markers, effectiveLegend, confidenceThreshold]);

  const metrics = React.useMemo(() => {
    let high = 0;
    let review = 0;
    let verified = 0;
    let aiVerified = 0;
    let manual = 0;

    activeMarkers.forEach((m) => {
      if (m.status === "user_verified") verified++;
      else if (m.status === "ai_verified") aiVerified++;
      else if (m.status === "manual_added") manual++;
      else if (m.status === "needs_review") review++;
      else high++;
    });

    return {
      total: activeMarkers.length,
      high,
      review,
      verified,
      aiVerified,
      manual,
    };
  }, [activeMarkers]);

  // Filtered legends and counts
  const tallyData = React.useMemo(() => {
    const counts: Record<string, number> = {};
    markers.forEach((m) => {
      if (m.status === "manual_added" || m.status === "user_verified" || m.status === "ai_verified" || m.confidence_score >= confidenceThreshold) {
        counts[m.legend_id] = (counts[m.legend_id] || 0) + 1;
      }
    });

    return legends
      .filter((l) => stageFilter === "All" || l.fix_stage === stageFilter)
      .map((l) => ({
        ...l,
        count: counts[l.legend_id] || 0,
      }));
  }, [legends, markers, confidenceThreshold, stageFilter]);

  // Standard rooms for matrix breakdown
  const roomNames = [
    "Living Room",
    "Kitchen",
    "Dining",
    "Hall / Stairs",
    "Bedroom 1",
    "Bedroom 2",
    "Bedroom 3",
    "Bathroom",
    "En-suite",
    "WC",
    "Roof / Solar PV",
  ];

  return (
    <div 
      className="right-sidebar"
      style={{
        width: isExpanded ? 520 : 360,
        minWidth: isExpanded ? 520 : 360,
        transition: "width 0.22s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
      }}
    >
      {/* Top Header Bar with Expand / Collapse Width Toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #334155", background: "#0B132B" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Layers size={14} style={{ color: "#3B82F6" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#F8FAFC", letterSpacing: 0.3 }}>
            TAKEOFF & QC
          </span>
          <span style={{ fontSize: 10, background: "#1E293B", color: "#94A3B8", padding: "2px 6px", borderRadius: 4, fontFamily: "JetBrains Mono" }}>
            {stageStats.total} total
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            background: isExpanded ? "rgba(59, 130, 246, 0.2)" : "#1E293B",
            border: isExpanded ? "1px solid #3B82F6" : "1px solid #334155",
            color: isExpanded ? "#60A5FA" : "#94A3B8",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            transition: "all 0.15s ease"
          }}
          title={isExpanded ? "Collapse to standard 360px sidebar" : "Expand to wider 520px takeoff view"}
        >
          {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          <span>{isExpanded ? "Collapse" : "Expand"}</span>
        </button>
      </div>

      {/* Verification Audit Quality Control Box (Scoped strictly to selected symbol) */}
      <div className="qc-audit-box" style={{ margin: "10px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: effectiveLegend?.color || "#3B82F6",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
              QC AUDIT {effectiveLegend?.label ? `(${effectiveLegend.label.length > 18 ? effectiveLegend.label.slice(0, 16) + '...' : effectiveLegend.label})` : ""}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "#F8FAFC", fontWeight: 700 }}>
              {metrics.total} Items
            </span>
            <button
              type="button"
              onClick={() => setIsQcCollapsed(!isQcCollapsed)}
              style={{
                background: "transparent",
                border: "none",
                color: "#94A3B8",
                cursor: "pointer",
                padding: "2px 4px",
                display: "flex",
                alignItems: "center"
              }}
              title={isQcCollapsed ? "Expand QC Audit panel" : "Collapse QC Audit panel"}
            >
              {isQcCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
        </div>

        {!isQcCollapsed && (
          <>
            {/* Symbol Switcher Dropdown */}
            {legends.length > 0 && onSelectLegendId && (
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <select
                  value={effectiveLegend?.legend_id || ""}
                  onChange={(e) => onSelectLegendId(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#0F172A",
                    border: "1px solid #334155",
                    color: "#F8FAFC",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    outline: "none",
                  }}
                  title="Select symbol to inspect in QC Audit"
                >
                  {legends.map((l) => {
                    const total = markers.filter((m) => m.legend_id === l.legend_id).length;
                    const active = markers.filter((m) => {
                      if (m.legend_id !== l.legend_id) return false;
                      if (m.status === "user_verified" || m.status === "manual_added" || m.status === "ai_verified") return true;
                      return m.confidence_score === undefined || m.confidence_score === null || m.confidence_score >= confidenceThreshold;
                    }).length;
                    const countStr = active === total ? `${active} points` : `${active} of ${total} points`;
                    return (
                      <option key={l.legend_id} value={l.legend_id}>
                        {l.label} ({countStr})
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            <div className="audit-metrics-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <div className="audit-metric-card" style={{ borderLeft: "3px solid #10B981" }}>
                <span className="audit-metric-val" style={{ color: "#10B981" }}>
                  {metrics.verified + metrics.high}
                </span>
                <span className="audit-metric-label">Approved</span>
              </div>

              <div className="audit-metric-card" style={{ borderLeft: "3px solid #8B5CF6" }}>
                <span className="audit-metric-val" style={{ color: "#8B5CF6" }}>
                  {metrics.aiVerified}
                </span>
                <span className="audit-metric-label">AI Confirmed</span>
              </div>

              <div className="audit-metric-card" style={{ borderLeft: "3px solid #F59E0B" }}>
                <span className="audit-metric-val" style={{ color: "#F59E0B" }}>
                  {metrics.review}
                </span>
                <span className="audit-metric-label">Needs Review</span>
              </div>

              <div className="audit-metric-card" style={{ borderLeft: "3px solid #06B6D4" }}>
                <span className="audit-metric-val" style={{ color: "#06B6D4" }}>
                  {metrics.manual}
                </span>
                <span className="audit-metric-label">Manual</span>
              </div>
            </div>

            {/* Confidence Threshold Slider */}
            <div className="confidence-slider-container">
              <div className="confidence-slider-header">
                <span>Confidence Filter</span>
                <span style={{ color: "#3B82F6", fontFamily: "JetBrains Mono", fontWeight: 700 }}>
                  {Math.round(confidenceThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                className="confidence-slider"
                min={0.50}
                max={0.95}
                step={0.01}
                value={confidenceThreshold}
                onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
                title="Adjust real-time confidence filter for candidates"
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Run 1st-Pass AI Auto-Count for Any Given Selected Symbol */}
              {selectedLegend && onRunFirstPassForSelected && (
                <button
                  className="btn-primary"
                  style={{
                    fontSize: 11,
                    padding: "8px 12px",
                    background: "linear-gradient(135deg, #2563EB, #1D4ED8)",
                    borderColor: "#3B82F6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    fontWeight: 600,
                    borderRadius: 6,
                    boxShadow: "0 2px 8px rgba(37, 99, 235, 0.3)",
                  }}
                  onClick={onRunFirstPassForSelected}
                  disabled={isProcessingAI}
                  title={`Run 1st-Pass AI Auto-Count for ${selectedLegend.label}`}
                >
                  <Zap size={14} />
                  <span>
                    {activeMarkers.length > 0
                      ? `Re-Run 1st-Pass AI Count (${selectedLegend.label})`
                      : `Run 1st-Pass AI Count (${selectedLegend.label})`}
                  </span>
                </button>
              )}
              {metrics.aiVerified > 0 && onBatchApproveAIVerified && (
                <button
                  className="btn-primary"
                  style={{ fontSize: 11, padding: "7px 12px", background: "#8B5CF6" }}
                  onClick={onBatchApproveAIVerified}
                  title="User sign-off: Approve all AI-confirmed candidates for this symbol"
                >
                  <ShieldCheck size={14} />
                  <span>Sign-Off AI Confirmed ({metrics.aiVerified})</span>
                </button>
              )}

              {metrics.high > 0 && (
                <button
                  className="btn-success"
                  style={{ fontSize: 11, padding: "7px 12px" }}
                  onClick={onBatchApproveHighConfidence}
                  title="Approve high confidence candidates for this symbol"
                >
                  <ShieldCheck size={14} />
                  <span>Approve High Confidence ({metrics.high})</span>
                </button>
              )}

              {onRunAIAudit && activeMarkers.length > 0 && (
                <button
                  className="btn-primary"
                  style={{
                    fontSize: 11,
                    padding: "7px 12px",
                    background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
                    borderColor: "#7C3AED",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                  onClick={onRunAIAudit}
                  disabled={isAuditingAI}
                  title="Open AI Second-Pass Audit for this symbol"
                >
                  <Sparkles size={14} />
                  <span>AI Second-Pass Audit ({activeMarkers.length})...</span>
                </button>
              )}

              {/* Quick Clear / Approve buttons */}
              {selectedLegend && activeMarkers.length > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onClearCandidatesForLegend?.(selectedLegend.legend_id)}
                    style={{ flex: 1, fontSize: 10, padding: "5px 6px", color: "#EF4444", borderColor: "rgba(239, 68, 68, 0.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                    title="Clear unverified/review candidate circles for this symbol"
                  >
                    <RotateCcw size={11} />
                    <span>Clear Candidates</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onApproveAllForLegend?.(selectedLegend.legend_id)}
                    style={{ flex: 1, fontSize: 10, padding: "5px 6px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
                    title="Approve all candidates for this symbol"
                  >
                    <CheckCheck size={11} />
                    <span>Approve All</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tabs: Tally vs Room Breakdown */}
      <div className="sidebar-tabs">
        <div
          className={`sidebar-tab ${activeTab === "tally" ? "active" : ""}`}
          onClick={() => setActiveTab("tally")}
        >
          Bill of Quantities
        </div>
        <div
          className={`sidebar-tab ${activeTab === "rooms" ? "active" : ""}`}
          onClick={() => setActiveTab("rooms")}
        >
          Room Schedule
        </div>
      </div>

      {activeTab === "tally" && (
        <>
          {/* 1st Fix & 2nd Fix Stage Summary KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "0 14px 10px 14px" }}>
            <div 
              onClick={() => setStageFilter(stageFilter === "1st Fix" ? "All" : "1st Fix")}
              style={{
                background: stageFilter === "1st Fix" ? "rgba(59, 130, 246, 0.2)" : "#1E293B",
                border: stageFilter === "1st Fix" ? "1px solid #3B82F6" : "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxShadow: stageFilter === "1st Fix" ? "0 0 10px rgba(59, 130, 246, 0.2)" : "none"
              }}
              title="Click to filter 1st Fix items"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  1st Fix Total
                </span>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#38BDF8" }} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#38BDF8", fontFamily: "JetBrains Mono", marginTop: 2 }}>
                {stageStats.firstFix} <span style={{ fontSize: 11, fontWeight: 500, color: "#94A3B8" }}>units</span>
              </div>
            </div>

            <div 
              onClick={() => setStageFilter(stageFilter === "2nd Fix" ? "All" : "2nd Fix")}
              style={{
                background: stageFilter === "2nd Fix" ? "rgba(16, 185, 129, 0.2)" : "#1E293B",
                border: stageFilter === "2nd Fix" ? "1px solid #10B981" : "1px solid #334155",
                borderRadius: 8,
                padding: "8px 10px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxShadow: stageFilter === "2nd Fix" ? "0 0 10px rgba(16, 185, 129, 0.2)" : "none"
              }}
              title="Click to filter 2nd Fix items"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  2nd Fix Total
                </span>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34D399" }} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#34D399", fontFamily: "JetBrains Mono", marginTop: 2 }}>
                {stageStats.secondFix} <span style={{ fontSize: 11, fontWeight: 500, color: "#94A3B8" }}>units</span>
              </div>
            </div>
          </div>

          {/* Stage Filter Pills */}
          <div style={{ display: "flex", gap: 4, padding: "0 14px 8px 14px" }}>
            {["All", "1st Fix", "2nd Fix", "Specialist"].map((st) => (
              <button
                key={st}
                onClick={() => setStageFilter(st)}
                style={{
                  background: stageFilter === st ? "#3B82F6" : "#1E293B",
                  color: stageFilter === st ? "#FFFFFF" : "#94A3B8",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="tally-table-container">
            <table className="tally-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Stage</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {tallyData.map((item) => {
                  const isSelected = selectedLegend?.legend_id === item.legend_id;
                  return (
                    <tr
                      key={item.legend_id}
                      onClick={() => onSelectLegendId && onSelectLegendId(item.legend_id)}
                      style={{
                        cursor: "pointer",
                        backgroundColor: isSelected ? "rgba(59, 130, 246, 0.12)" : undefined,
                        borderLeft: isSelected ? `3px solid ${item.color}` : "3px solid transparent",
                        transition: "all 0.15s ease",
                      }}
                      title="Click to select and inspect this symbol"
                    >
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor: item.color,
                              flexShrink: 0,
                              boxShadow: isSelected ? `0 0 8px ${item.color}` : "none",
                            }}
                          />
                          <span style={{ fontWeight: isSelected ? 700 : 600, color: isSelected ? "#F8FAFC" : "#E2E8F0" }}>
                            {item.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: "#64748B", paddingLeft: 16 }}>
                          {item.manufacturer} • {item.part_code}
                        </div>
                      </td>
                      <td style={{ fontSize: 11, color: "#94A3B8" }}>{item.fix_stage}</td>
                      <td style={{ textAlign: "right" }}>
                        <span className="tally-count-badge" style={{ backgroundColor: isSelected ? "#3B82F6" : undefined, color: isSelected ? "#FFFFFF" : undefined }}>
                          {item.count}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === "rooms" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            className="btn-primary"
            style={{ fontSize: 11, padding: "7px 12px" }}
            onClick={onDetectRoomsAI}
            disabled={isDetectingRooms}
          >
            <Sparkles size={14} />
            <span>{isDetectingRooms ? "Analyzing Floor Plan..." : `AI Auto-Detect Rooms (${rooms.length} Active)`}</span>
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {roomNames.map((rName) => {
              // Count markers in this room
              const inRoom = markers.filter(
                (m) => rName.toLowerCase().includes(m.room.toLowerCase()) || m.room.toLowerCase().includes(rName.toLowerCase())
              );

              return (
                <div
                  key={rName}
                  style={{
                    background: "#1E293B",
                    borderRadius: 8,
                    padding: "8px 10px",
                    border: "1px solid #334155",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{rName}</span>
                  <span className="tally-count-badge">{inRoom.length} items</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Session State & Auto-Save Indicator */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid #334155", background: "#0F172A", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: "#10B981" }} />
          <span style={{ fontSize: 10, color: "#94A3B8" }}>
            {lastSavedTime ? `Saved at ${lastSavedTime}` : "Auto-Save Active"}
          </span>
        </div>
        {onSaveSession && (
          <button
            type="button"
            className="btn-secondary"
            onClick={onSaveSession}
            disabled={isSaving}
            style={{ fontSize: 10, padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
            title="Save all session progress to disk"
          >
            <Save size={11} />
            <span>{isSaving ? "Saving..." : "Save Project"}</span>
          </button>
        )}
      </div>

      {/* Audit-Ready 1-Click Export Actions */}
      <div className="export-panel" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {onExportMasterTender && (
          <button
            className="btn-primary"
            onClick={onExportMasterTender}
            style={{
              background: "linear-gradient(135deg, #059669 0%, #047857 100%)",
              border: "1px solid #10B981",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.25)",
              fontWeight: 600
            }}
            title="Populate Column A in master tender template and calculate 1st Fix, 2nd Fix & Tender"
          >
            <FileSpreadsheet size={15} />
            <span>Export 36-Sheet Master Tender (.xlsx)</span>
          </button>
        )}

        <button className="btn-primary" onClick={onExportExcel}>
          <FileSpreadsheet size={15} />
          <span>Export Multi-Tab BoQ + Audit</span>
        </button>

        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onExportPdf}>
            <FileDown size={14} />
            <span>Annotated PDF</span>
          </button>

          {onOpenSymbolLibrary && (
            <button
              className="btn-secondary"
              style={{
                flex: 1,
                background: "rgba(59, 130, 246, 0.12)",
                color: "#60A5FA",
                borderColor: "rgba(59, 130, 246, 0.3)"
              }}
              onClick={onOpenSymbolLibrary}
              title="Open full CAD-to-Sheet symbol catalog"
            >
              <BookOpen size={14} />
              <span>Symbol Library</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
