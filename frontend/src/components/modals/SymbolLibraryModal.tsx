import React, { useState, useEffect } from "react";
import { X, Search, Plus, BookOpen, Crop } from "lucide-react";
import { api } from "../../services/api";

interface SymbolItem {
  symbol_id: string;
  cad_label: string;
  cad_abbreviation: string;
  sheet_row: number;
  sheet_desc: string;
  manufacturer: string;
  part_code: string;
  unit_price: number;
  category: string;
  fix_stage: string;
  box_type: string;
  cable_per_point_m?: number;
  cable_type?: string;
  room_override?: any;
}

interface SymbolLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecropSymbol?: (symbol: SymbolItem) => void;
}

export const SymbolLibraryModal: React.FC<SymbolLibraryModalProps> = ({
  isOpen,
  onClose,
  onRecropSymbol,
}) => {
  const [library, setLibrary] = useState<SymbolItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editItem, setEditItem] = useState<SymbolItem | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadLibrary();
    }
  }, [isOpen]);

  const loadLibrary = async () => {
    setIsLoading(true);
    try {
      const data = await api.getSymbolLibrary();
      setLibrary(data);
    } catch (err) {
      console.error("Failed to load symbol library", err);
    } finally {
      setIsLoading(false);
    }
  };

  const categories = ["All", ...Array.from(new Set(library.map((i) => i.category || "General")))];

  const filtered = library.filter((item) => {
    const matchesSearch =
      item.cad_label.toLowerCase().includes(search.toLowerCase()) ||
      item.sheet_desc.toLowerCase().includes(search.toLowerCase()) ||
      item.part_code.toLowerCase().includes(search.toLowerCase()) ||
      item.cad_abbreviation.toLowerCase().includes(search.toLowerCase());
    const matchesCat = selectedCategory === "All" || item.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const handleSaveEdit = async () => {
    if (!editItem) return;
    setIsSaving(true);
    try {
      const updated = library.map((i) => (i.symbol_id === editItem.symbol_id ? editItem : i));
      if (!library.some((i) => i.symbol_id === editItem.symbol_id)) {
        updated.push(editItem);
      }
      await api.updateSymbolLibrary(updated);
      setLibrary(updated);
      setEditItem(null);
    } catch (err) {
      alert("Failed to save changes: " + err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" style={{ zIndex: 1200 }}>
      <div
        className="modal-container"
        style={{
          maxWidth: "1050px",
          width: "92vw",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "14px",
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(180deg, #181c24 0%, #0f1218 100%)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.7)"
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "rgba(59, 130, 246, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#60A5FA"
              }}
            >
              <BookOpen size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#F3F4F6" }}>
                Jeffway Electrical Symbol & Catalog Library
              </h2>
              <span style={{ fontSize: "12px", color: "#9CA3AF" }}>
                Dynamic CAD Legend $\leftrightarrow$ 36-Sheet Tender Procurement Catalog Mapping ({library.length} Components)
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#9CA3AF",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "6px"
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar: Search & Categories */}
        <div
          style={{
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(0,0,0,0.15)"
          }}
        >
          <div style={{ position: "relative", flex: 1, maxWidth: "340px" }}>
            <Search
              size={14}
              style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#6B7280" }}
            />
            <input
              type="text"
              placeholder="Search symbol, part code, or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px 8px 32px",
                borderRadius: "7px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#F3F4F6",
                fontSize: "13px",
                outline: "none"
              }}
            />
          </div>

          {/* Categories */}
          <div style={{ display: "flex", gap: "6px", overflowX: "auto" }}>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: selectedCategory === cat ? 600 : 400,
                  border: "none",
                  cursor: "pointer",
                  background:
                    selectedCategory === cat
                      ? "rgba(59, 130, 246, 0.25)"
                      : "rgba(255,255,255,0.04)",
                  color: selectedCategory === cat ? "#60A5FA" : "#9CA3AF"
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <button
            onClick={() =>
              setEditItem({
                symbol_id: `sym_${Date.now()}`,
                cad_label: "New Electrical Component",
                cad_abbreviation: "",
                sheet_row: 18,
                sheet_desc: "Switched Twin Socket",
                manufacturer: "Deta",
                part_code: "S1209S",
                unit_price: 1.75,
                category: "Power & Sockets",
                fix_stage: "2nd Fix",
                box_type: "Twin Metal Box 35mm",
                cable_per_point_m: 7.5,
                cable_type: "2.5 T+E"
              })
            }
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "7px",
              background: "rgba(16, 185, 129, 0.2)",
              color: "#34D399",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            <Plus size={14} />
            <span>Add Symbol</span>
          </button>
        </div>

        {/* Table Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 24px" }}>
          {isLoading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#9CA3AF" }}>
              Loading master catalog...
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "12px",
                color: "#E5E7EB"
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    color: "#9CA3AF",
                    textAlign: "left"
                  }}
                >
                  <th style={{ padding: "10px 8px" }}>CAD Symbol & Description</th>
                  <th style={{ padding: "10px 8px" }}>Jeffway Procurement Description</th>
                  <th style={{ padding: "10px 8px" }}>Part Code</th>
                  <th style={{ padding: "10px 8px" }}>Target Sheet Row</th>
                  <th style={{ padding: "10px 8px" }}>1st Fix Box</th>
                  <th style={{ padding: "10px 8px" }}>Cable Rate</th>
                  <th style={{ padding: "10px 8px" }}>Unit Price</th>
                  <th style={{ padding: "10px 8px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.symbol_id}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      background: "rgba(255,255,255,0.01)"
                    }}
                  >
                    <td style={{ padding: "10px 8px" }}>
                      <div style={{ fontWeight: 600, color: "#F9FAFB" }}>
                        {item.cad_label}
                      </div>
                      {item.cad_abbreviation && (
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: "rgba(239, 68, 68, 0.15)",
                            color: "#F87171",
                            fontWeight: 700
                          }}
                        >
                          Badge: {item.cad_abbreviation}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <span style={{ color: "#D1D5DB" }}>{item.sheet_desc}</span>
                      <div style={{ fontSize: "11px", color: "#6B7280" }}>
                        Mfr: {item.manufacturer}
                      </div>
                    </td>
                    <td style={{ padding: "10px 8px", fontFamily: "monospace", color: "#60A5FA" }}>
                      {item.part_code || "Standard"}
                    </td>
                    <td style={{ padding: "10px 8px" }}>
                      <span
                        style={{
                          background: "rgba(139, 92, 246, 0.15)",
                          color: "#A78BFA",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontWeight: 600
                        }}
                      >
                        Row {item.sheet_row}
                      </span>
                    </td>
                    <td style={{ padding: "10px 8px", color: "#9CA3AF" }}>
                      {item.box_type || "None"}
                    </td>
                    <td style={{ padding: "10px 8px", color: "#9CA3AF" }}>
                      {item.cable_per_point_m ? (
                        <span>
                          {item.cable_per_point_m}m{" "}
                          <span style={{ fontSize: "10px", color: "#6B7280" }}>
                            ({item.cable_type})
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "10px 8px", fontWeight: 600, color: "#34D399" }}>
                      £{item.unit_price ? item.unit_price.toFixed(2) : "0.00"}
                    </td>
                    <td style={{ padding: "10px 8px", textAlign: "right" }}>
                      {onRecropSymbol && (
                        <button
                          onClick={() => {
                            onRecropSymbol(item);
                            onClose();
                          }}
                          style={{
                            padding: "4px 8px",
                            borderRadius: "5px",
                            background: "rgba(59, 130, 246, 0.15)",
                            border: "1px solid rgba(59, 130, 246, 0.35)",
                            color: "#60A5FA",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                            marginRight: "6px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                          title="Close modal and re-crop this symbol icon from blueprint"
                        >
                          <Crop size={11} />
                          <span>Re-crop</span>
                        </button>
                      )}
                      <button
                        onClick={() => setEditItem(item)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: "5px",
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          color: "#E5E7EB",
                          fontSize: "11px",
                          cursor: "pointer"
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Edit Modal Drawer */}
        {editItem && (
          <div
            style={{
              padding: "16px 24px",
              background: "rgba(17, 24, 39, 0.95)",
              borderTop: "1px solid rgba(59, 130, 246, 0.3)",
              display: "flex",
              flexWrap: "wrap",
              gap: "12px",
              alignItems: "flex-end"
            }}
          >
            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block" }}>
                CAD Description
              </label>
              <input
                type="text"
                value={editItem.cad_label}
                onChange={(e) => setEditItem({ ...editItem, cad_label: e.target.value })}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "5px",
                  background: "#1F2937",
                  border: "1px solid #374151",
                  color: "#FFF",
                  fontSize: "12px"
                }}
              />
            </div>

            <div style={{ flex: 1, minWidth: "180px" }}>
              <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block" }}>
                Jeffway Sheet Description
              </label>
              <input
                type="text"
                value={editItem.sheet_desc}
                onChange={(e) => setEditItem({ ...editItem, sheet_desc: e.target.value })}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "5px",
                  background: "#1F2937",
                  border: "1px solid #374151",
                  color: "#FFF",
                  fontSize: "12px"
                }}
              />
            </div>

            <div style={{ width: "100px" }}>
              <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block" }}>
                Part Code
              </label>
              <input
                type="text"
                value={editItem.part_code}
                onChange={(e) => setEditItem({ ...editItem, part_code: e.target.value })}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "5px",
                  background: "#1F2937",
                  border: "1px solid #374151",
                  color: "#FFF",
                  fontSize: "12px"
                }}
              />
            </div>

            <div style={{ width: "90px" }}>
              <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block" }}>
                Sheet Row #
              </label>
              <input
                type="number"
                value={editItem.sheet_row}
                onChange={(e) =>
                  setEditItem({ ...editItem, sheet_row: parseInt(e.target.value) || 10 })
                }
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "5px",
                  background: "#1F2937",
                  border: "1px solid #374151",
                  color: "#FFF",
                  fontSize: "12px"
                }}
              />
            </div>

            <div style={{ width: "90px" }}>
              <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block" }}>
                Unit Price (£)
              </label>
              <input
                type="number"
                step="0.01"
                value={editItem.unit_price}
                onChange={(e) =>
                  setEditItem({ ...editItem, unit_price: parseFloat(e.target.value) || 0 })
                }
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "5px",
                  background: "#1F2937",
                  border: "1px solid #374151",
                  color: "#FFF",
                  fontSize: "12px"
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                style={{
                  padding: "7px 16px",
                  borderRadius: "6px",
                  background: "#2563EB",
                  color: "#FFF",
                  border: "none",
                  fontWeight: 600,
                  fontSize: "12px",
                  cursor: "pointer"
                }}
              >
                {isSaving ? "Saving..." : "Save Mapping"}
              </button>
              <button
                onClick={() => setEditItem(null)}
                style={{
                  padding: "7px 12px",
                  borderRadius: "6px",
                  background: "transparent",
                  border: "1px solid #4B5563",
                  color: "#9CA3AF",
                  fontSize: "12px",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
