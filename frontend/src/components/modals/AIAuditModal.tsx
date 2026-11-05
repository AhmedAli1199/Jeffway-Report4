import React, { useState, useMemo, useEffect } from "react";
import { 
  X, 
  Sparkles, 
  ShieldCheck, 
  Filter, 
  AlertTriangle,
  Loader2,
  RotateCcw,
  Eye
} from "lucide-react";
import type { LegendItem, Marker } from "../../types/takeoff";
import { api } from "../../services/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  legend: LegendItem | null;
  markers: Marker[];
  filepath: string;
  pageIndex: number;
  apiKey: string;
  allLegends?: LegendItem[];
  excludedZones?: any[];
  confidenceThreshold?: number;
  onApplyResults: (
    verifiedIds: string[], 
    rejectedIds: string[], 
    directApprove: boolean,
    resultsMap: Map<string, { is_valid: boolean; confidence: number; reason: string }>
  ) => void;
  onOpenApiKeyModal: () => void;
  onOpenAuditLog?: () => void;
}

export type AuditScope = "threshold" | "review" | "high" | "both" | "custom";

export const AIAuditModal: React.FC<Props> = ({
  isOpen,
  onClose,
  legend,
  markers,
  filepath,
  pageIndex,
  apiKey,
  allLegends,
  excludedZones,
  confidenceThreshold,
  onApplyResults,
  onOpenApiKeyModal,
  onOpenAuditLog,
}) => {
  const [scope, setScope] = useState<AuditScope>("threshold");
  const [customSelectedIds, setCustomSelectedIds] = useState<Set<string>>(new Set());
  const [customInstructions, setCustomInstructions] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Results State
  const [auditResults, setAuditResults] = useState<{
    marker_id: string;
    is_valid: boolean;
    confidence: number;
    reason: string;
    suggested_reclassification?: string;
  }[] | null>(null);

  // Automatically reset previous results whenever active legend changes or modal re-opens
  useEffect(() => {
    setAuditResults(null);
    setErrorMessage(null);
    setCustomSelectedIds(new Set());
    setScope("threshold");
  }, [legend?.legend_id, isOpen]);

  const handleClearAuditResults = () => {
    setAuditResults(null);
    setErrorMessage(null);
  };

  const thresholdVal = confidenceThreshold ?? 0.55;

  // Filter candidates on this page for this legend
  const pageMarkers = useMemo(() => {
    if (!legend) return [];
    return markers.filter(
      (m) => m.page_index === pageIndex && m.legend_id === legend.legend_id
    );
  }, [markers, pageIndex, legend]);

  const thresholdMarkers = useMemo(() => {
    return pageMarkers.filter(
      (m) => m.status !== "user_verified" && (m.confidence_score ?? 0) >= thresholdVal
    );
  }, [pageMarkers, thresholdVal]);

  const reviewMarkers = useMemo(() => {
    return pageMarkers.filter((m) => m.status === "needs_review");
  }, [pageMarkers]);

  const highMarkers = useMemo(() => {
    return pageMarkers.filter((m) => m.status === "ai_unverified" && m.confidence_score >= 0.78);
  }, [pageMarkers]);

  // Determine active candidates to send based on scope
  const targetMarkers = useMemo(() => {
    if (scope === "threshold") return thresholdMarkers;
    if (scope === "review") return reviewMarkers;
    if (scope === "high") return highMarkers;
    if (scope === "both") return pageMarkers.filter((m) => m.status !== "user_verified");
    // custom
    return pageMarkers.filter((m) => customSelectedIds.has(m.marker_id));
  }, [scope, thresholdMarkers, reviewMarkers, highMarkers, pageMarkers, customSelectedIds]);

  if (!isOpen || !legend) return null;

  const toggleCustomSelect = (id: string) => {
    setCustomSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectThresholdCustom = () => {
    setCustomSelectedIds(new Set(thresholdMarkers.map((m) => m.marker_id)));
  };

  const handleSelectAllCustom = () => {
    setCustomSelectedIds(new Set(pageMarkers.map((m) => m.marker_id)));
  };

  const handleDeselectAllCustom = () => {
    setCustomSelectedIds(new Set());
  };

  const handleRunAudit = async () => {
    if (!apiKey) {
      onOpenApiKeyModal();
      return;
    }
    if (targetMarkers.length === 0) {
      setErrorMessage("Please select at least one candidate symbol to audit.");
      return;
    }

    setIsRunning(true);
    setErrorMessage(null);

    try {
      const res = await api.verifyCandidatesAI({
        filepath,
        page_index: pageIndex,
        legend,
        markers: targetMarkers,
        api_key: apiKey,
        all_legends: allLegends,
        excluded_zones: excludedZones,
      });

      if (res.verifications && res.verifications.length > 0) {
        setAuditResults(res.verifications);
      } else {
        setErrorMessage("AI completed the audit but returned no verification rows.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to communicate with AI vision model.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleCommit = (directApprove: boolean) => {
    if (!auditResults) return;
    const verifiedIds: string[] = [];
    const rejectedIds: string[] = [];
    const resultsMap = new Map<string, { is_valid: boolean; confidence: number; reason: string }>();

    auditResults.forEach((r) => {
      resultsMap.set(r.marker_id, r);
      if (r.is_valid) {
        verifiedIds.push(r.marker_id);
      } else {
        rejectedIds.push(r.marker_id);
      }
    });

    onApplyResults(verifiedIds, rejectedIds, directApprove, resultsMap);
    onClose();
  };

  const confirmedCount = auditResults ? auditResults.filter((r) => r.is_valid).length : 0;
  const rejectedCount = auditResults ? auditResults.filter((r) => !r.is_valid).length : 0;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 680, maxWidth: "94vw", maxHeight: "90vh" }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F8FAFC" }}>
                AI Vision Second-Pass Audit
              </h3>
              <p style={{ fontSize: 11, color: "#94A3B8" }}>
                Auditing symbol: <strong style={{ color: legend.color }}>{legend.label}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ overflowY: "auto", maxHeight: "calc(90vh - 140px)" }}>
          {errorMessage && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#FCA5A5",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertTriangle size={16} color="#EF4444" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!auditResults ? (
            <>
              {/* Scope Selection Options */}
              <div className="form-group">
                <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Filter size={13} color="#3B82F6" />
                  <span>Choose Candidates Scope to Audit</span>
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {/* Option 1: Above Confidence Threshold (Active Filter) */}
                  <div
                    onClick={() => setScope("threshold")}
                    style={{
                      gridColumn: "1 / -1",
                      background: scope === "threshold" ? "rgba(6, 182, 212, 0.12)" : "#111827",
                      border: scope === "threshold" ? "2px solid #06B6D4" : "1px solid #334155",
                      borderRadius: 8,
                      padding: "12px 14px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: scope === "threshold" ? "#22D3EE" : "#F8FAFC" }}>
                          Above Confidence Threshold (≥ {Math.round(thresholdVal * 100)}%)
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            background: "#0891B2",
                            color: "#FFFFFF",
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontWeight: 700,
                          }}
                        >
                          Auto Filter
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "#94A3B8", marginTop: 3, display: "block" }}>
                        Automatically sends only candidates meeting your active confidence slider ({thresholdMarkers.length} of {pageMarkers.length} candidates).
                      </span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: "JetBrains Mono",
                          background: "rgba(6, 182, 212, 0.2)",
                          color: "#22D3EE",
                          padding: "4px 10px",
                          borderRadius: 6,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {thresholdMarkers.length} items
                      </span>
                    </div>
                  </div>

                  {/* Option 2: Needs Review */}
                  <div
                    onClick={() => setScope("review")}
                    style={{
                      background: scope === "review" ? "#1E293B" : "#111827",
                      border: scope === "review" ? "2px solid #F59E0B" : "1px solid #334155",
                      borderRadius: 8,
                      padding: 12,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B" }}>
                        Needs Review Only
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "JetBrains Mono",
                          background: "rgba(245, 158, 11, 0.2)",
                          color: "#F59E0B",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 700,
                        }}
                      >
                        {reviewMarkers.length} items
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: "#94A3B8" }}>
                      Inspects ambiguous spots, overlapping lines, and low-confidence outliers.
                    </span>
                  </div>

                  {/* Option 3: High Confidence */}
                  <div
                    onClick={() => setScope("high")}
                    style={{
                      background: scope === "high" ? "#1E293B" : "#111827",
                      border: scope === "high" ? "2px solid #10B981" : "1px solid #334155",
                      borderRadius: 8,
                      padding: 12,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#10B981" }}>
                        High Confidence (≥ 78%)
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "JetBrains Mono",
                          background: "rgba(16, 185, 129, 0.2)",
                          color: "#10B981",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 700,
                        }}
                      >
                        {highMarkers.length} items
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: "#94A3B8" }}>
                      Double-check the high-scoring matches before signing off.
                    </span>
                  </div>

                  {/* Option 4: Both / All */}
                  <div
                    onClick={() => setScope("both")}
                    style={{
                      background: scope === "both" ? "#1E293B" : "#111827",
                      border: scope === "both" ? "2px solid #3B82F6" : "1px solid #334155",
                      borderRadius: 8,
                      padding: 12,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#3B82F6" }}>
                        All Candidates (Full Sheet)
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "JetBrains Mono",
                          background: "rgba(59, 130, 246, 0.2)",
                          color: "#3B82F6",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 700,
                        }}
                      >
                        {pageMarkers.filter((m) => m.status !== "user_verified").length} items
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: "#94A3B8" }}>
                      Audits all candidates detected across the entire sheet simultaneously regardless of score.
                    </span>
                  </div>

                  {/* Option 5: Custom Selection */}
                  <div
                    onClick={() => setScope("custom")}
                    style={{
                      background: scope === "custom" ? "#1E293B" : "#111827",
                      border: scope === "custom" ? "2px solid #8B5CF6" : "1px solid #334155",
                      borderRadius: 8,
                      padding: 12,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#8B5CF6" }}>
                        Custom Selection
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "JetBrains Mono",
                          background: "rgba(139, 92, 246, 0.2)",
                          color: "#8B5CF6",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontWeight: 700,
                        }}
                      >
                        {customSelectedIds.size} picked
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: "#94A3B8" }}>
                      Pick specific candidates manually using individual checkboxes.
                    </span>
                  </div>
                </div>
              </div>

              {/* Custom Selection List */}
              {scope === "custom" && (
                <div className="form-group" style={{ marginTop: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>Pick Candidates:</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={handleSelectThresholdCustom}
                        style={{
                          background: "rgba(6, 182, 212, 0.15)",
                          border: "1px solid #06B6D4",
                          color: "#22D3EE",
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                        title={`Select only candidates with confidence ≥ ${Math.round(thresholdVal * 100)}%`}
                      >
                        Above Threshold ({thresholdMarkers.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectAllCustom}
                        style={{ background: "#1E293B", border: "1px solid #334155", color: "#94A3B8", fontSize: 10, padding: "2px 6px", borderRadius: 4, cursor: "pointer" }}
                      >
                        Select All ({pageMarkers.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleDeselectAllCustom}
                        style={{ background: "#1E293B", border: "1px solid #334155", color: "#94A3B8", fontSize: 10, padding: "2px 6px", borderRadius: 4, cursor: "pointer" }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, maxHeight: 180, overflowY: "auto", background: "#0B0F19", padding: 8, borderRadius: 8, border: "1px solid #334155" }}>
                    {pageMarkers.map((m) => {
                      const isPicked = customSelectedIds.has(m.marker_id);
                      return (
                        <div
                          key={m.marker_id}
                          onClick={() => toggleCustomSelect(m.marker_id)}
                          style={{
                            background: isPicked ? "rgba(139, 92, 246, 0.2)" : "#1E293B",
                            border: isPicked ? "1px solid #8B5CF6" : "1px solid #334155",
                            borderRadius: 6,
                            padding: "6px 8px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isPicked}
                            onChange={() => {}}
                            style={{ accentColor: "#8B5CF6" }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#F8FAFC" }}>
                              {m.room || "Unassigned"}
                            </div>
                            <div style={{ fontSize: 9, color: "#94A3B8", fontFamily: "JetBrains Mono" }}>
                              {Math.round(m.confidence_score * 100)}% • {m.status}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Instructions Input */}
              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">
                  Special Guidance / Custom Prompt for AI (Optional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Look out for symbols overlapping sink basin outlines or red dashed wires"
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                />
              </div>
            </>
          ) : (
            /* Populated AI Results Screen */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8" }}>
                  AI Verification Results for <span style={{ color: legend.color }}>{legend.label}</span>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {onOpenAuditLog && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={onOpenAuditLog}
                      style={{ fontSize: 11, padding: "4px 8px", display: "flex", alignItems: "center", gap: 5, color: "#60A5FA", borderColor: "#1E40AF" }}
                      title="Inspect exact prompts, images, and raw responses in the Inspection Log"
                    >
                      <Eye size={12} />
                      <span>AI Inspection Log</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleClearAuditResults}
                    style={{ fontSize: 11, padding: "4px 8px", display: "flex", alignItems: "center", gap: 5, color: "#EF4444", borderColor: "#7F1D1D" }}
                    title="Discard these results and return to candidate selection"
                  >
                    <RotateCcw size={12} />
                    <span>Clear Results & Re-Run</span>
                  </button>
                </div>
              </div>

              {/* Summary Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                <div style={{ background: "#111827", border: "1px solid #334155", borderRadius: 8, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#F8FAFC", fontFamily: "JetBrains Mono" }}>
                    {auditResults.length}
                  </div>
                  <div style={{ fontSize: 10, color: "#94A3B8" }}>Total Analyzed</div>
                </div>

                <div style={{ background: "#111827", border: "1px solid rgba(16, 185, 129, 0.4)", borderRadius: 8, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#10B981", fontFamily: "JetBrains Mono" }}>
                    {confirmedCount}
                  </div>
                  <div style={{ fontSize: 10, color: "#10B981" }}>Confirmed Genuine</div>
                </div>

                <div style={{ background: "#111827", border: "1px solid rgba(239, 68, 68, 0.4)", borderRadius: 8, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#EF4444", fontFamily: "JetBrains Mono" }}>
                    {rejectedCount}
                  </div>
                  <div style={{ fontSize: 10, color: "#EF4444" }}>False Alarms Dropped</div>
                </div>
              </div>

              {/* Itemized Results List */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto", background: "#0B0F19", padding: 8, borderRadius: 8, border: "1px solid #334155" }}>
                {auditResults.map((r, idx) => {
                  const targetMarker = markers.find((m) => m.marker_id === r.marker_id);
                  return (
                    <div
                      key={r.marker_id}
                      style={{
                        background: "#1E293B",
                        borderRadius: 6,
                        padding: "8px 10px",
                        border: r.is_valid ? "1px solid rgba(139, 92, 246, 0.4)" : "1px solid rgba(239, 68, 68, 0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "#64748B", width: 22 }}>
                          #{idx + 1}
                        </span>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#F8FAFC" }}>
                              {targetMarker?.room || "Location"}
                            </span>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: r.is_valid ? "rgba(139, 92, 246, 0.2)" : "rgba(239, 68, 68, 0.2)",
                                color: r.is_valid ? "#A78BFA" : "#EF4444",
                              }}
                            >
                              {r.is_valid ? "AI CONFIRMED" : "REJECTED"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                            {r.reason}
                          </div>
                        </div>
                      </div>

                      <div style={{ fontSize: 11, fontFamily: "JetBrains Mono", fontWeight: 700, color: r.is_valid ? "#10B981" : "#EF4444" }}>
                        {Math.round(r.confidence * 100)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {!apiKey && (
              <button
                className="btn-secondary"
                style={{ fontSize: 11, color: "#F59E0B" }}
                onClick={onOpenApiKeyModal}
              >
                Set OpenAI API Key
              </button>
            )}
            {auditResults && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 11, color: "#EF4444", borderColor: "#7F1D1D", display: "flex", alignItems: "center", gap: 4 }}
                onClick={handleClearAuditResults}
              >
                <RotateCcw size={12} />
                <span>Discard & Re-Select</span>
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>

            {!auditResults ? (
              <button
                className="btn-primary"
                onClick={handleRunAudit}
                disabled={isRunning || targetMarkers.length === 0}
                style={{ minWidth: 160 }}
              >
                {isRunning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Auditing {targetMarkers.length} Items...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Run AI Audit ({targetMarkers.length})</span>
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  className="btn-primary"
                  style={{ background: "#8B5CF6" }}
                  onClick={() => handleCommit(false)}
                >
                  <Sparkles size={14} />
                  <span>Apply as AI Confirmed</span>
                </button>

                <button
                  className="btn-success"
                  onClick={() => handleCommit(true)}
                >
                  <ShieldCheck size={14} />
                  <span>Sign-Off & Approve Directly</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
