import React, { useState, useEffect } from "react";
import { X, RefreshCw, Trash2, Eye } from "lucide-react";
import { api } from "../../services/api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const AIAuditLogModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"visual" | "prompt" | "raw">("visual");

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAuditLogs();
      setLogs(res.logs || []);
      if (res.logs && res.logs.length > 0) {
        setSelectedLogIndex(0);
      }
    } catch (err) {
      console.error("Failed to load audit logs", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

  const handleClear = async () => {
    if (confirm("Clear all recorded AI inspection logs?")) {
      await api.clearAuditLogs();
      setLogs([]);
    }
  };

  if (!isOpen) return null;

  const currentLog = logs[selectedLogIndex];

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ width: 960, maxWidth: "96vw", height: "88vh", maxHeight: "900px" }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #3B82F6, #1D4ED8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Eye size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F8FAFC" }}>
                AI Vision Audit Inspector & Diagnostics Portal
              </h3>
              <p style={{ fontSize: 11, color: "#94A3B8" }}>
                Inspect exact images, prompt text, and raw responses sent to and received from GPT-4o Vision
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={loadLogs}
              className="btn-secondary"
              style={{ padding: "5px 10px", fontSize: 11 }}
              title="Refresh logs"
            >
              <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
            <button
              onClick={handleClear}
              className="btn-secondary"
              style={{ padding: "5px 10px", fontSize: 11, color: "#EF4444" }}
              title="Clear all logs"
            >
              <Trash2 size={13} />
              <span>Clear</span>
            </button>
            <button
              onClick={onClose}
              style={{ background: "transparent", border: "none", color: "#94A3B8", cursor: "pointer", marginLeft: 6 }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Layout: Left Sidebar Runs List + Right Detailed Inspector */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Left Runs List */}
          <div
            style={{
              width: 260,
              borderRight: "1px solid #334155",
              background: "#0B0F19",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "10px 12px", borderBottom: "1px solid #1E293B", fontSize: 11, fontWeight: 700, color: "#94A3B8" }}>
              RUN HISTORY ({logs.length})
            </div>
            {logs.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#64748B", fontSize: 12 }}>
                No AI audits recorded yet. Run an AI Second-Pass Audit to view diagnostics here.
              </div>
            ) : (
              logs.map((lg, idx) => {
                const isSel = idx === selectedLogIndex;
                const totalCand = lg.candidates?.length || 0;
                const approvedCount = lg.verifications?.filter((v: any) => v.is_valid)?.length || 0;
                return (
                  <div
                    key={lg.id || idx}
                    onClick={() => setSelectedLogIndex(idx)}
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #1E293B",
                      cursor: "pointer",
                      background: isSel ? "#1E293B" : "transparent",
                      borderLeft: isSel ? "3px solid #3B82F6" : "3px solid transparent",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: isSel ? "#60A5FA" : "#F8FAFC" }}>
                      {lg.legend_label}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>
                      {lg.timestamp}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "#334155", color: "#CBD5E1" }}>
                        {totalCand} items
                      </span>
                      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: approvedCount > 0 ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)", color: approvedCount > 0 ? "#10B981" : "#EF4444" }}>
                        {approvedCount} approved
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right Main Panel */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "#0F172A" }}>
            {currentLog ? (
              <>
                {/* Tabs bar */}
                <div style={{ display: "flex", borderBottom: "1px solid #334155", background: "#111827", padding: "0 16px" }}>
                  <button
                    onClick={() => setActiveTab("visual")}
                    style={{
                      padding: "10px 14px",
                      background: "transparent",
                      border: "none",
                      borderBottom: activeTab === "visual" ? "2px solid #3B82F6" : "2px solid transparent",
                      color: activeTab === "visual" ? "#60A5FA" : "#94A3B8",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Visual Crops ({currentLog.candidates?.length || 0})
                  </button>
                  <button
                    onClick={() => setActiveTab("prompt")}
                    style={{
                      padding: "10px 14px",
                      background: "transparent",
                      border: "none",
                      borderBottom: activeTab === "prompt" ? "2px solid #3B82F6" : "2px solid transparent",
                      color: activeTab === "prompt" ? "#60A5FA" : "#94A3B8",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Prompt Sent to AI
                  </button>
                  <button
                    onClick={() => setActiveTab("raw")}
                    style={{
                      padding: "10px 14px",
                      background: "transparent",
                      border: "none",
                      borderBottom: activeTab === "raw" ? "2px solid #3B82F6" : "2px solid transparent",
                      color: activeTab === "raw" ? "#60A5FA" : "#94A3B8",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Raw AI Response (JSON)
                  </button>
                </div>

                {/* Tab 1: Visual Crops */}
                {activeTab === "visual" && (
                  <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                    {/* Reference Template Box */}
                    <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: 12, marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 8 }}>
                        IMAGE 1: REFERENCE TEMPLATE SENT TO AI
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ width: 80, height: 80, background: "#000", border: "1px solid #475569", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          <img
                            src={`data:image/png;base64,${currentLog.template_image_b64}`}
                            alt="Reference Template"
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#F8FAFC" }}>
                              {currentLog.legend_label}
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: "rgba(59, 130, 246, 0.15)", color: "#60A5FA", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
                              {currentLog.model_used || "gpt-5-mini"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                            This image was passed as Image #1 (the ground truth reference).
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Candidate Patches Grid */}
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 8 }}>
                      CANDIDATE CROPS EVALUATED ({currentLog.candidates?.length || 0})
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                      {currentLog.candidates?.map((c: any, i: number) => {
                        const ver = currentLog.verifications?.find((v: any) => v.marker_id === c.marker_id) || currentLog.verifications?.[i];
                        const isValid = ver?.is_valid;
                        return (
                          <div
                            key={c.marker_id || i}
                            style={{
                              background: "#1E293B",
                              borderRadius: 8,
                              border: isValid ? "2px solid #10B981" : "1px solid rgba(239, 68, 68, 0.4)",
                              padding: 10,
                              display: "flex",
                              gap: 12,
                            }}
                          >
                            <div style={{ width: 80, height: 80, background: "#000", border: "1px solid #334155", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                              <img
                                src={`data:image/png;base64,${c.patch_b64}`}
                                alt={`Candidate ${i + 1}`}
                                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#F8FAFC" }}>
                                  #{i + 1}
                                </span>
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: 4,
                                    background: isValid ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)",
                                    color: isValid ? "#10B981" : "#EF4444",
                                  }}
                                >
                                  {isValid ? "APPROVED" : "REJECTED"}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: "#CBD5E1", marginTop: 4, lineHeight: 1.4 }}>
                                {ver?.reason || "No reasoning returned"}
                              </div>
                              <div style={{ fontSize: 10, color: "#64748B", fontFamily: "JetBrains Mono", marginTop: 4 }}>
                                Conf: {ver ? Math.round(ver.confidence * 100) : 0}%
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tab 2: Prompt Text */}
                {activeTab === "prompt" && (
                  <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                    <pre
                      style={{
                        background: "#020617",
                        padding: 16,
                        borderRadius: 8,
                        border: "1px solid #334155",
                        color: "#E2E8F0",
                        fontSize: 12,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {currentLog.prompt_text}
                    </pre>
                  </div>
                )}

                {/* Tab 3: Raw AI Response */}
                {activeTab === "raw" && (
                  <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                    <pre
                      style={{
                        background: "#020617",
                        padding: 16,
                        borderRadius: 8,
                        border: "1px solid #334155",
                        color: "#38BDF8",
                        fontSize: 12,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {(() => {
                        try {
                          return JSON.stringify(JSON.parse(currentLog.raw_response), null, 2);
                        } catch {
                          return currentLog.raw_response;
                        }
                      })()}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "#64748B" }}>
                Select a run from the history to view its diagnostics.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
