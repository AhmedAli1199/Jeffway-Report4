import React, { useState, useEffect, useRef } from "react";
import { api } from "./services/api";
import type { Project, LegendItem, Marker, ToolMode, RoomZone, ExcludedZone } from "./types/takeoff";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { RightSidebar } from "./components/sidebar/RightSidebar";
import { BlueprintCanvas } from "./components/canvas/BlueprintCanvas";
import { FloatingToolbar } from "./components/toolbar/FloatingToolbar";
import { InstanceNavigator } from "./components/toolbar/InstanceNavigator";
import { CreateLegendModal } from "./components/modals/CreateLegendModal";
import { AIAuditModal } from "./components/modals/AIAuditModal";
import { AIAuditLogModal } from "./components/modals/AIAuditLogModal";
import { SymbolLibraryModal } from "./components/modals/SymbolLibraryModal";
import { 
  Building2, 
  Sparkles, 
  Key, 
  Loader2,
  Eye,
  Save
} from "lucide-react";

export const App: React.FC = () => {
  // Project & Sheets State
  const [, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(23); // Default to Page 24: Ground Floor Electrical Plan
  const [isLoadingProject, setIsLoadingProject] = useState<boolean>(true);
  const [isSymbolLibraryOpen, setIsSymbolLibraryOpen] = useState<boolean>(false);

  // Takeoff Data State
  const [legends, setLegends] = useState<LegendItem[]>([
    {
      legend_id: "leg_double_socket",
      label: "13A Switched Double Socket",
      color: "#EF4444",
      category: "Power & Accessories",
      fix_stage: "2nd Fix",
      manufacturer: "Deta",
      part_code: "SD1209CHW",
      count: 0,
    },
    {
      legend_id: "leg_pendant",
      label: "Pendant Light Fitting",
      color: "#3B82F6",
      category: "Lighting & Controls",
      fix_stage: "2nd Fix",
      manufacturer: "Deta",
      part_code: "S1400",
      count: 0,
    },
    {
      legend_id: "leg_downlight",
      label: "Recessed Downlighter",
      color: "#10B981",
      category: "Lighting & Controls",
      fix_stage: "2nd Fix",
      manufacturer: "Deta",
      part_code: "L1200",
      count: 0,
    },
    {
      legend_id: "leg_smoke",
      label: "Ceiling Smoke Detector",
      color: "#F59E0B",
      category: "Safety & Fire",
      fix_stage: "2nd Fix",
      manufacturer: "Aico",
      part_code: "Ei3016",
      count: 0,
    },
    {
      legend_id: "leg_fan",
      label: "Extract Fan (Continuous)",
      color: "#8B5CF6",
      category: "Heating & Ventilation",
      fix_stage: "2nd Fix",
      manufacturer: "Greenwood",
      part_code: "Unity CV2GIP",
      count: 0,
    }
  ]);
  const [selectedLegendId, setSelectedLegendId] = useState<string>("leg_double_socket");
  const [cropTargetLegend, setCropTargetLegend] = useState<LegendItem | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [rooms, setRooms] = useState<RoomZone[]>([]);

  // Excluded Legend Zones per Sheet
  const [excludedZonesByPage, setExcludedZonesByPage] = useState<Record<number, ExcludedZone[]>>({});
  const currentExcludedZones = excludedZonesByPage[currentPageIndex] || [];

  // Auto-sync selectedLegendId if current id does not exist in legends
  useEffect(() => {
    if (legends.length > 0) {
      const exists = legends.some((l) => l.legend_id === selectedLegendId);
      if (!exists) {
        setSelectedLegendId(legends[0].legend_id);
      }
    }
  }, [legends, selectedLegendId]);

  // Session State & Auto-Save
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Canvas & Interaction State
  const [activeTool, setActiveTool] = useState<ToolMode>("pan");
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.55);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [navigatorFilter, setNavigatorFilter] = useState<"review" | "ai" | "high" | "all">("review");
  const stageRef = useRef<any>(null);

  // Modal State for Crop Creation
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [pendingCropCoords, setPendingCropCoords] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [pendingCropB64, setPendingCropB64] = useState<string | undefined>();
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [processingSymbolName, setProcessingSymbolName] = useState("");
  const [isScanningLegendAI, setIsScanningLegendAI] = useState(false);
  const [isDetectingRoomsAI, setIsDetectingRoomsAI] = useState(false);

  // OpenAI API Key Modal & AI Diagnostics Log Modal
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem("jeffway_openai_key") || "");
  const [auditLogModalOpen, setAuditLogModalOpen] = useState(false);

  // Keyboard Shortcuts for Rapid Review (A = Approve, Del = Delete, Left/Right = Navigate)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === "a" || e.key === "A") {
        if (selectedMarkerId) {
          handleApproveMarker(selectedMarkerId);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedMarkerId) {
          handleDeleteMarker(selectedMarkerId);
        }
      } else if (e.key === "ArrowRight") {
        advanceMarker(1);
      } else if (e.key === "ArrowLeft") {
        advanceMarker(-1);
      } else if (e.key === "Escape") {
        if (activeTool === "exclude_zone" || activeTool === "crop_legend") {
          setActiveTool("pan");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedMarkerId, markers, navigatorFilter, activeTool]);

  const getFilteredMarkers = () => {
    const pageMarkers = markers.filter((m) => {
      if (m.page_index !== currentPageIndex) return false;
      if (selectedLegendId && m.legend_id !== selectedLegendId) return false;
      if (m.status === "user_verified" || m.status === "ai_verified" || m.status === "manual_added") return true;
      return m.confidence_score >= confidenceThreshold;
    });
    if (navigatorFilter === "review") {
      return pageMarkers.filter((m) => m.status === "needs_review");
    } else if (navigatorFilter === "ai") {
      return pageMarkers.filter((m) => m.status === "ai_verified");
    } else if (navigatorFilter === "high") {
      return pageMarkers.filter((m) => m.status === "ai_unverified");
    }
    return pageMarkers;
  };

  // Real-time confidence filter: if active selected marker falls below threshold, jump to next valid candidate
  useEffect(() => {
    if (selectedMarkerId) {
      const cur = markers.find((m) => m.marker_id === selectedMarkerId);
      if (cur && cur.status !== "user_verified" && cur.status !== "ai_verified" && cur.status !== "manual_added") {
        if (cur.confidence_score < confidenceThreshold) {
          const list = getFilteredMarkers();
          setSelectedMarkerId(list.length > 0 ? list[0].marker_id : null);
        }
      }
    }
  }, [confidenceThreshold, markers, currentPageIndex, selectedLegendId, selectedMarkerId, navigatorFilter]);

  const advanceMarker = (direction: number) => {
    const list = getFilteredMarkers();
    if (list.length === 0) return;
    const curIdx = list.findIndex((m) => m.marker_id === selectedMarkerId);
    let nextIdx = 0;
    if (curIdx >= 0) {
      nextIdx = (curIdx + direction + list.length) % list.length;
    }
    setSelectedMarkerId(list[nextIdx].marker_id);
  };

  const handleApproveMarker = (markerId: string) => {
    setMarkers((prev) =>
      prev.map((m) => (m.marker_id === markerId ? { ...m, status: "user_verified" } : m))
    );
    // Automatically advance to the next symbol needing review
    setTimeout(() => advanceMarker(1), 50);
  };

  // Load projects and restore previous session state on startup
  useEffect(() => {
    async function init() {
      try {
        const list = await api.listProjects();
        setProjects(list);
        if (list.length > 0) {
          const defaultProj = list[0];
          const details = await api.getProjectDetails(defaultProj.project_id, defaultProj.filepath);
          setCurrentProject(details as any);

          // Check if user has saved session state in localStorage first
          const localSavedRaw = localStorage.getItem(`jeffway_takeoff_${defaultProj.project_id}`);
          let localSaved: any = null;
          if (localSavedRaw) {
            try {
              localSaved = JSON.parse(localSavedRaw);
            } catch (e) {
              console.error("Failed to parse local saved state", e);
            }
          }

          // Always take backend master symbol library if available, and purge any legacy 7-item localStorage cache
          localStorage.removeItem(`jeffway_takeoff_${defaultProj.project_id}`);

          if (details.legends && details.legends.length > 0) {
            setLegends(details.legends);
          } else if (localSaved?.legends && localSaved.legends.length > 0) {
            setLegends(localSaved.legends);
          }

          // Restore markers (fresh empty state from backend)
          setMarkers(details.markers || []);

          // Restore rooms
          if (localSaved?.rooms && localSaved.rooms.length > 0) {
            setRooms(localSaved.rooms);
          } else if (details.rooms && details.rooms.length > 0) {
            setRooms(details.rooms);
          }

          // Restore excluded zones, sanitizing any legacy faulty boxes (e.g. giant box across center)
          const rawZones = localSaved?.excludedZonesByPage || details.excluded_zones;
          if (rawZones) {
            const cleaned: Record<number, ExcludedZone[]> = {};
            for (const [pg, zones] of Object.entries(rawZones)) {
              if (Array.isArray(zones)) {
                const valid = (zones as ExcludedZone[]).filter(
                  (z) => z.width < 1200 && !(z.x > 250 && z.x < 1200 && z.y < 350 && z.width > 1000)
                );
                if (valid.length > 0) {
                  cleaned[Number(pg)] = valid;
                }
              }
            }
            setExcludedZonesByPage(cleaned);
          }

          if (localSaved?.savedAt) {
            setLastSavedTime(new Date(localSaved.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
          }

          // Find first electrical plan page (prefer Page 25 / index 24)
          const elecPage = details.pages.find((p: any) => p.is_electrical && p.page_number === 25) ||
                           details.pages.find((p: any) => p.is_electrical && p.page_number === 24) ||
                           details.pages.find((p: any) => p.is_electrical);
          if (elecPage) {
            setCurrentPageIndex(elecPage.page_index);
          }
        }
      } catch (err) {
        console.error("Failed to load projects", err);
      } finally {
        setIsLoadingProject(false);
      }
    }
    init();
  }, []);

  // Automatically detect sheet legend zone when switching to an electrical page if not already configured
  useEffect(() => {
    if (!currentProject) return;
    const currentZones = excludedZonesByPage[currentPageIndex];
    if (!currentZones || currentZones.length === 0) {
      api.getLegendZone(currentProject.filepath, currentPageIndex)
        .then((res) => {
          if (res.legend_zone) {
            setExcludedZonesByPage((prev) => ({
              ...prev,
              [currentPageIndex]: [{ ...res.legend_zone, label: "Legend Excluded" }],
            }));
          }
        })
        .catch(() => {});
    }
  }, [currentProject, currentPageIndex]);

  // Persist session state to both localStorage and backend database
  const handleSaveSession = async () => {
    if (!currentProject) return;
    setIsSaving(true);
    try {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      localStorage.setItem(
        `jeffway_takeoff_${currentProject.project_id}`,
        JSON.stringify({
          legends,
          markers,
          rooms,
          excludedZonesByPage,
          savedAt: now.toISOString(),
        })
      );
      await api.saveState({
        project_id: currentProject.project_id,
        legends,
        markers,
        rooms,
        excluded_zones: excludedZonesByPage,
      });
      setLastSavedTime(timeStr);
    } catch (e) {
      console.error("Failed to persist project state", e);
    } finally {
      setIsSaving(false);
    }
  };

  // Debounced auto-save (triggers 2.5s after any marker, legend, or exclusion modification)
  useEffect(() => {
    if (!currentProject || markers.length === 0) return;
    const timer = setTimeout(() => {
      handleSaveSession();
    }, 2500);
    return () => clearTimeout(timer);
  }, [markers, legends, rooms, excludedZonesByPage]);

  // Excluded Zone Handlers
  const handleSetExcludedZones = (zones: ExcludedZone[]) => {
    setExcludedZonesByPage((prev) => ({
      ...prev,
      [currentPageIndex]: zones,
    }));
  };

  const handleClearExcludedZone = () => {
    setExcludedZonesByPage((prev) => ({
      ...prev,
      [currentPageIndex]: [],
    }));
  };

  // Manual or automatic re-detection of the Electrical Legend boundaries
  const handleAutoDetectLegend = async () => {
    if (!currentProject) return;
    try {
      const res = await api.getLegendZone(currentProject.filepath, currentPageIndex);
      if (res.legend_zone) {
        setExcludedZonesByPage((prev) => ({
          ...prev,
          [currentPageIndex]: [{ ...res.legend_zone, label: "Legend Excluded (Auto)" }],
        }));
      } else {
        alert("No explicit electrical legend table was detected on this sheet. You can drag an exclusion box by hand using 'Exclude Legend'.");
      }
    } catch (e: any) {
      alert(`Auto-detect note: ${e.message}`);
    }
  };

  // Per-Symbol Candidate Management
  const handleClearCandidatesForLegend = (legendId: string) => {
    setMarkers((prev) =>
      prev.filter(
        (m) =>
          !(
            m.legend_id === legendId &&
            m.page_index === currentPageIndex &&
            (m.status === "needs_review" || m.status === "ai_unverified")
          )
      )
    );
  };

  const handleApproveAllForLegend = (legendId: string) => {
    setMarkers((prev) =>
      prev.map((m) =>
        m.legend_id === legendId && m.page_index === currentPageIndex && m.status !== "user_verified"
          ? { ...m, status: "user_verified" }
          : m
      )
    );
  };

  // Save API key
  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem("jeffway_openai_key", key);
    setApiKeyModalOpen(false);
  };

  // Zoom controls
  const handleZoomIn = () => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const newScale = Math.min(10, oldScale * 1.25);
    stage.scale({ x: newScale, y: newScale });
    stage.batchDraw();
  };

  const handleZoomOut = () => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const newScale = Math.max(0.15, oldScale / 1.25);
    stage.scale({ x: newScale, y: newScale });
    stage.batchDraw();
  };

  const handleResetZoom = () => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    stage.scale({ x: 0.35, y: 0.35 });
    stage.position({ x: 50, y: 50 });
    stage.batchDraw();
  };

  // Marker Operations
  const handleAddManualMarker = (x: number, y: number) => {
    if (!selectedLegendId) return;
    const newMarker: Marker = {
      marker_id: `mk_man_${Date.now()}`,
      legend_id: selectedLegendId,
      x: x - 15,
      y: y - 15,
      width: 30,
      height: 30,
      confidence_score: 1.0,
      status: "manual_added",
      room: getRoomForCoordinate(x, y),
      page_index: currentPageIndex,
      page_number: currentPageIndex + 1,
    };
    setMarkers((prev) => [...prev, newMarker]);
  };

  const handleUpdateMarker = (markerId: string, updates: Partial<Marker>) => {
    setMarkers((prev) =>
      prev.map((m) => (m.marker_id === markerId ? { ...m, ...updates } : m))
    );
  };

  const handleDeleteMarker = (markerId: string) => {
    setMarkers((prev) => prev.filter((m) => m.marker_id !== markerId));
  };

  const handleBatchApproveHighConfidence = () => {
    setMarkers((prev) =>
      prev.map((m) => {
        if (m.confidence_score >= 0.82 && m.status === "ai_unverified") {
          return { ...m, status: "user_verified" };
        }
        return m;
      })
    );
  };

  const handleBatchApproveAIVerified = () => {
    setMarkers((prev) =>
      prev.map((m) => {
        if (m.status === "ai_verified") {
          return { ...m, status: "user_verified" };
        }
        return m;
      })
    );
  };

  // Room spatial lookup
  const getRoomForCoordinate = (x: number, y: number): string => {
    for (const r of rooms) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return r.name;
      }
    }
    return "Unassigned";
  };

  // Crop Completed -> Open Modal
  const handleCompleteCrop = (
    coords: { x: number; y: number; width: number; height: number },
    imageB64?: string
  ) => {
    setPendingCropCoords(coords);
    setPendingCropB64(imageB64);
    setCropModalOpen(true);
    setActiveTool("pan");
  };

  // Re-crop Symbol from Blueprint
  const handleRecropLegend = (legend: LegendItem) => {
    setCropTargetLegend(legend);
    setSelectedLegendId(legend.legend_id);
    setActiveTool("crop_legend");
  };

  // Re-crop Symbol from Library Modal
  const handleRecropFromLibrary = (item: any) => {
    const existing = legends.find((l) => l.legend_id === item.legend_id || l.label === item.cad_label);
    if (existing) {
      handleRecropLegend(existing);
    } else {
      const newLeg: LegendItem = {
        legend_id: item.legend_id || item.symbol_id || `leg_${Date.now()}`,
        label: item.cad_label || item.sheet_desc,
        color: item.color || "#EF4444",
        category: item.category || "Switches & Lighting",
        fix_stage: item.fix_stage || "2nd Fix",
        manufacturer: item.manufacturer || "Deta",
        part_code: item.part_code || "Standard",
        count: 0,
      };
      setLegends((prev) => [...prev, newLeg]);
      handleRecropLegend(newLeg);
    }
  };

  // Save new template and run AI Auto-Count
  const handleSaveAndRunAI = async (newLegend: LegendItem, runAI: boolean) => {
    setLegends((prev) => {
      const exists = prev.some((l) => l.legend_id === newLegend.legend_id);
      return exists ? prev.map((l) => (l.legend_id === newLegend.legend_id ? newLegend : l)) : [...prev, newLegend];
    });
    setSelectedLegendId(newLegend.legend_id);
    setCropModalOpen(false);
    setCropTargetLegend(null);

    // Sync updated crop to master symbol library in backend
    try {
      const masterLib = await api.getSymbolLibrary();
      const updatedLib = masterLib.map((item: any) => {
        if (item.legend_id === newLegend.legend_id || item.cad_label === newLegend.label) {
          return {
            ...item,
            template_crop_coords: newLegend.template_crop_coords,
            template_image_b64: newLegend.template_image_b64,
          };
        }
        return item;
      });
      await api.updateSymbolLibrary(updatedLib);
    } catch (e) {
      console.warn("Failed to sync crop to master symbol library:", e);
    }

    if (runAI && currentProject) {
      setProcessingSymbolName(newLegend.label);
      setIsProcessingAI(true);
      try {
        const result = await api.runAutoCount({
          project_id: currentProject.project_id,
          filepath: currentProject.filepath,
          page_index: currentPageIndex,
          legend: newLegend,
          min_confidence: 0.50,
          excluded_zones: currentExcludedZones.length > 0 ? currentExcludedZones : undefined,
        });

        // If backend detected legend zone and none was configured yet, save it
        if (result.legend_zone && currentExcludedZones.length === 0) {
          setExcludedZonesByPage((prev) => ({
            ...prev,
            [currentPageIndex]: [{ ...result.legend_zone, label: "Legend Excluded" }],
          }));
        }

        // Assign rooms to detected markers with explicit page_index
        const withRooms = result.markers.map((m) => ({
          ...m,
          page_index: currentPageIndex,
          page_number: currentPageIndex + 1,
          room: getRoomForCoordinate(m.x, m.y),
        }));

        setMarkers((prev) => {
          const remaining = prev.filter((m) => {
            if (m.legend_id !== newLegend.legend_id) return true;
            return m.status === "user_verified" || m.status === "manual_added";
          });
          return [...remaining, ...withRooms];
        });

        // Automatically set filter and focus on candidate #1 for immediate review
        if (withRooms.length > 0) {
          const hasReview = withRooms.some((m) => m.status === "needs_review");
          setNavigatorFilter(hasReview ? "review" : "all");
          setSelectedMarkerId(withRooms[0].marker_id);
        }
      } catch (err: any) {
        alert(`Inference note: ${err.message}`);
      } finally {
        setIsProcessingAI(false);
      }
    }
  };

  // Run 1st-Pass AI Auto-Count on demand for any given selected symbol
  const handleRunFirstPassForSelected = async () => {
    const targetLegend = selectedLegend || (legends.length > 0 ? legends[0] : null);
    if (!targetLegend) {
      alert("Please select a symbol first from the QC Audit dropdown or BoQ table.");
      return;
    }
    if (!currentProject) {
      alert("No active project loaded.");
      return;
    }
    setSelectedLegendId(targetLegend.legend_id);

    if (!targetLegend.template_crop_coords && !targetLegend.template_image_b64) {
      alert(`Symbol "${targetLegend.label}" does not have a visual template crop yet. Please draw a box around a sample instance on the blueprint canvas.`);
      setCropTargetLegend(targetLegend);
      setActiveTool("crop_legend");
      return;
    }

    setProcessingSymbolName(targetLegend.label);
    setIsProcessingAI(true);
    try {
      const result = await api.runAutoCount({
        project_id: currentProject.project_id,
        filepath: currentProject.filepath,
        page_index: currentPageIndex,
        legend: targetLegend,
        min_confidence: 0.50,
        excluded_zones: currentExcludedZones.length > 0 ? currentExcludedZones : undefined,
      });

      if (result.legend_zone && currentExcludedZones.length === 0) {
        setExcludedZonesByPage((prev) => ({
          ...prev,
          [currentPageIndex]: [{ ...result.legend_zone, label: "Legend Excluded" }],
        }));
      }

      const withRooms = result.markers.map((m) => ({
        ...m,
        page_index: currentPageIndex,
        page_number: currentPageIndex + 1,
        room: getRoomForCoordinate(m.x, m.y),
      }));

      // Preserve user confirmed/manual/ai-verified pins, replace unverified candidate circles
      setMarkers((prev) => {
        const remaining = prev.filter((m) => {
          if (m.legend_id !== targetLegend.legend_id) return true;
          return m.status === "user_verified" || m.status === "manual_added" || m.status === "ai_verified";
        });

        // Deduplicate new candidates against already confirmed pins for the SAME symbol at the same location
        const dedupedNew = withRooms.filter((newM) => {
          const newCx = newM.x + (newM.width || 20) / 2;
          const newCy = newM.y + (newM.height || 20) / 2;
          const refR = Math.max(30, Math.max(newM.width || 20, newM.height || 20) * 1.45);
          return !remaining.some((ex) => {
            if (ex.page_index !== currentPageIndex) return false;
            // CRITICAL: Must only deduplicate against markers of the SAME legend!
            if (ex.legend_id !== targetLegend.legend_id) return false;
            const exCx = ex.x + (ex.width || 20) / 2;
            const exCy = ex.y + (ex.height || 20) / 2;
            const dist = Math.sqrt((newCx - exCx) ** 2 + (newCy - exCy) ** 2);
            return dist < refR;
          });
        });

        return [...remaining, ...dedupedNew];
      });

      // Update legends state count for targetLegend
      setLegends((prev) =>
        prev.map((l) =>
          l.legend_id === targetLegend.legend_id
            ? { ...l, count: withRooms.length }
            : l
        )
      );

      // Automatically set filter and focus on candidate #1 for immediate review
      if (withRooms.length > 0) {
        const hasReview = withRooms.some((m) => m.status === "needs_review");
        setNavigatorFilter(hasReview ? "review" : "all");
        setSelectedMarkerId(withRooms[0].marker_id);
      }
    } catch (err: any) {
      alert(`Inference note: ${err.message}`);
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Preset addition
  const handleAddPresetLegend = (label: string, category: string, fixStage: any, color: string) => {
    const id = `leg_${Date.now()}`;
    const newLeg: LegendItem = {
      legend_id: id,
      label,
      color,
      category,
      fix_stage: fixStage,
      manufacturer: "Deta",
      part_code: "Slimline Standard",
    };
    setLegends((prev) => [...prev, newLeg]);
    setSelectedLegendId(id);
    setActiveTool("manual_add");
  };

  // AI Second-Pass Verification for Ambiguous / Needs-Review Markers
  const [aiAuditModalOpen, setAiAuditModalOpen] = useState(false);

  const handleOpenAIAudit = () => {
    if (!apiKey) {
      setApiKeyModalOpen(true);
      return;
    }
    if (!selectedLegend) {
      alert("Please select a symbol from the Legend sidebar first.");
      return;
    }
    setAiAuditModalOpen(true);
  };

  const handleApplyAuditResults = (
    verifiedIds: string[],
    rejectedIds: string[],
    directApprove: boolean,
    resultsMap: Map<string, { is_valid: boolean; confidence: number; reason: string }>
  ) => {
    const verifiedSet = new Set(verifiedIds);
    const rejectedSet = new Set(rejectedIds);

    setMarkers((prev) =>
      prev
        .filter((m) => !rejectedSet.has(m.marker_id))
        .map((m) => {
          if (verifiedSet.has(m.marker_id)) {
            const auditData = resultsMap.get(m.marker_id);
            return {
              ...m,
              status: directApprove ? "user_verified" : "ai_verified",
              confidence_score: auditData ? auditData.confidence : m.confidence_score,
              metadata: {
                ...m.metadata,
                ai_audit_reason: auditData?.reason,
                ai_audit_confidence: auditData?.confidence,
              },
            };
          }
          return m;
        })
    );
  };

  // AI Auto-Scan Legend
  const handleScanLegendAI = async () => {
    if (!currentProject) return;
    setIsScanningLegendAI(true);
    try {
      const res = await api.scanLegendAI({
        filepath: currentProject.filepath,
        page_index: currentPageIndex,
        api_key: apiKey,
      });
      if (res.symbols && res.symbols.length > 0) {
        const newLegs: LegendItem[] = res.symbols.map((s: any, idx: number) => ({
          legend_id: `leg_ai_${Date.now()}_${idx}`,
          label: s.label || "Symbol",
          color: s.suggested_color || "#3B82F6",
          category: s.category || "Electrical",
          fix_stage: s.fix_stage || "2nd Fix",
          manufacturer: s.manufacturer || "Deta",
          part_code: s.part_code || "Standard",
        }));
        setLegends((prev) => [...prev, ...newLegs]);
      }
    } catch (err: any) {
      alert(`AI Scan Note: ${err.message}. You can manually crop symbols using the 'Crop Symbol' tool on the toolbar.`);
    } finally {
      setIsScanningLegendAI(false);
    }
  };

  // AI Auto-Detect Rooms
  const handleDetectRoomsAI = async () => {
    if (!currentProject) return;
    setIsDetectingRoomsAI(true);
    try {
      const res = await api.detectRoomsAI({
        filepath: currentProject.filepath,
        page_index: currentPageIndex,
        api_key: apiKey,
      });
      if (res.rooms && res.rooms.length > 0) {
        setRooms(res.rooms);
        // Re-attribute existing markers to detected rooms
        setMarkers((prev) =>
          prev.map((m) => {
            for (const r of res.rooms) {
              if (m.x >= r.x && m.x <= r.x + r.width && m.y >= r.y && m.y <= r.y + r.height) {
                return { ...m, room: r.name };
              }
            }
            return m;
          })
        );
      }
    } catch (err: any) {
      // Fallback default rooms for The Avebury Ground Floor
      const defaultAveburyRooms: RoomZone[] = [
        { name: "Living Room", x: 1000, y: 550, width: 850, height: 750 },
        { name: "Hall", x: 1850, y: 650, width: 350, height: 600 },
        { name: "Dining", x: 2200, y: 550, width: 500, height: 400 },
        { name: "Kitchen", x: 2200, y: 950, width: 500, height: 500 },
        { name: "WC", x: 1850, y: 1250, width: 350, height: 300 },
      ];
      setRooms(defaultAveburyRooms);
      setMarkers((prev) =>
        prev.map((m) => {
          for (const r of defaultAveburyRooms) {
            if (m.x >= r.x && m.x <= r.x + r.width && m.y >= r.y && m.y <= r.y + r.height) {
              return { ...m, room: r.name };
            }
          }
          return m;
        })
      );
    } finally {
      setIsDetectingRoomsAI(false);
    }
  };

  // Exports
  const handleExportMasterTender = async () => {
    if (!currentProject) return;
    try {
      await api.exportMasterTender({
        project_id: currentProject.project_id,
        project_name: currentProject.name,
        filepath: currentProject.filepath,
        legends,
        markers,
      });
    } catch (err: any) {
      alert(`Master Tender Export failed: ${err.message}`);
    }
  };

  const handleExportExcel = async () => {
    if (!currentProject) return;
    try {
      await api.exportExcel({
        project_id: currentProject.project_id,
        project_name: currentProject.name,
        filepath: currentProject.filepath,
        legends,
        markers,
      });
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  const handleExportPdf = async () => {
    if (!currentProject) return;
    try {
      await api.exportPdf({
        project_id: currentProject.project_id,
        project_name: currentProject.name,
        filepath: currentProject.filepath,
        legends,
        markers,
      });
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  };

  if (isLoadingProject) {
    return (
      <div className="app-container" style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Loader2 size={36} color="#3B82F6" className="animate-spin" />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Initializing Tender Pack & M&E Blueprints...</h2>
          <p style={{ fontSize: 12, color: "#94A3B8" }}>Loading PyMuPDF document parser & vision engine</p>
        </div>
      </div>
    );
  }

  const selectedLegend = legends.find((l) => l.legend_id === selectedLegendId);
  const currentSheet = currentProject?.pages[currentPageIndex];
  const imageUrl = currentProject
    ? api.getPageImageUrl(currentProject.filepath, currentPageIndex, 200)
    : "";

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-badge">
            <Sparkles size={15} />
            <span>JEFFWAY AI ESTIMATOR</span>
          </div>
          <div className="project-title-container">
            <div className="project-title">
              <Building2 size={15} color="#3B82F6" />
              <span>{currentProject?.name || "The Avebury (Curo Group)"}</span>
            </div>
            <div className="project-subtitle">
              {currentSheet?.title || "Ground Floor Electrical Plan"} • Sheet {currentPageIndex + 1} of {currentProject?.total_pages || 28}
            </div>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="btn-secondary"
            style={{ fontSize: 11, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, borderColor: "rgba(16, 185, 129, 0.4)", color: "#10B981" }}
            onClick={handleSaveSession}
            disabled={isSaving}
            title="Save all takeoff symbols, markers, and exclusions"
          >
            <Save size={13} color="#10B981" />
            <span>{isSaving ? "Saving..." : lastSavedTime ? `Saved (${lastSavedTime})` : "Save Session"}</span>
          </button>

          <button
            className="btn-secondary"
            style={{ fontSize: 11, padding: "6px 10px", borderColor: "#3B82F6", color: "#60A5FA" }}
            onClick={() => setAuditLogModalOpen(true)}
            title="Inspect what exact images, prompts, and raw responses were sent to GPT-4o Vision"
          >
            <Eye size={13} color="#60A5FA" />
            <span>AI Inspection Log</span>
          </button>

          <button
            className="btn-secondary"
            style={{ fontSize: 11, padding: "6px 10px" }}
            onClick={() => setApiKeyModalOpen(true)}
            title="Configure OpenAI API Key"
          >
            <Key size={13} color={apiKey ? "#10B981" : "#F59E0B"} />
            <span>{apiKey ? "OpenAI Connected" : "Set OpenAI Key"}</span>
          </button>
        </div>
      </header>

      {/* Main 3-Column Layout */}
      <div className="workspace-container">
        {/* Left Sidebar: Drawing Sheets & Legend */}
        {currentProject && (
          <LeftSidebar
            pages={currentProject.pages}
            currentPageIndex={currentPageIndex}
            onSelectPage={(idx) => setCurrentPageIndex(idx)}
            filepath={currentProject.filepath}
            legends={legends}
            selectedLegendId={selectedLegendId}
            onSelectLegend={(id) => setSelectedLegendId(id)}
            onDeleteLegend={(id) => setLegends((prev) => prev.filter((l) => l.legend_id !== id))}
            onRecropLegend={handleRecropLegend}
            onAddPresetLegend={handleAddPresetLegend}
            onScanLegendAI={handleScanLegendAI}
            markers={markers}
            isScanningAI={isScanningLegendAI}
          />
        )}

        {/* Center Stage: Interactive Blueprint Canvas */}
        <div className="center-stage">
          {/* Active Re-crop Banner */}
          {activeTool === "crop_legend" && cropTargetLegend && (
            <div
              style={{
                position: "absolute",
                top: 72,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 60,
                background: "rgba(15, 23, 42, 0.95)",
                border: "2px solid #3B82F6",
                borderRadius: 8,
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                backdropFilter: "blur(8px)",
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: cropTargetLegend.color || "#EF4444",
                }}
              />
              <div>
                <span style={{ fontSize: 12, color: "#F8FAFC", fontWeight: 700 }}>
                  Select Icon Crop for:{" "}
                  <span style={{ color: "#60A5FA" }}>{cropTargetLegend.label}</span>
                </span>
                <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: 8 }}>
                  (Draw a box around this symbol on the PDF. Excel mapping stays intact)
                </span>
              </div>
              <button
                onClick={() => {
                  setActiveTool("pan");
                  setCropTargetLegend(null);
                }}
                style={{
                  background: "#334155",
                  border: "none",
                  color: "#F8FAFC",
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}

          <FloatingToolbar
            activeTool={activeTool}
            onSelectTool={(tool) => {
              if (tool === "crop_legend") {
                setCropTargetLegend(null);
              }
              setActiveTool(tool);
            }}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={handleResetZoom}
            selectedLegendLabel={selectedLegend?.label}
            selectedLegendColor={selectedLegend?.color}
            hasSelectedMarker={!!selectedMarkerId}
            onDeleteSelectedMarker={() => {
              if (selectedMarkerId) handleDeleteMarker(selectedMarkerId);
            }}
            hasExcludedZone={currentExcludedZones.length > 0}
            onClearExcludedZone={handleClearExcludedZone}
            onAutoDetectLegend={handleAutoDetectLegend}
          />

          {/* Instance Zoom Navigator & Review Bar */}
          <InstanceNavigator
            markers={markers.filter((m) => m.page_index === currentPageIndex)}
            legends={legends}
            currentMarkerId={selectedMarkerId}
            filterMode={navigatorFilter}
            confidenceThreshold={confidenceThreshold}
            onRunFirstPassForSelected={handleRunFirstPassForSelected}
            isProcessingAI={isProcessingAI}
            onSelectFilterMode={(mode) => {
              setNavigatorFilter(mode);
              const list = markers.filter((m) => 
                m.page_index === currentPageIndex && 
                m.legend_id === selectedLegendId &&
                (m.status === "user_verified" || m.status === "ai_verified" || m.status === "manual_added" || m.confidence_score >= confidenceThreshold)
              );
              const filtered = mode === "review" 
                ? list.filter((m) => m.status === "needs_review")
                : mode === "ai"
                ? list.filter((m) => m.status === "ai_verified")
                : mode === "high"
                ? list.filter((m) => m.status === "ai_unverified")
                : list;
              if (filtered.length > 0) {
                setSelectedMarkerId(filtered[0].marker_id);
              }
            }}
            onJumpToMarker={(m) => setSelectedMarkerId(m.marker_id)}
            onApproveMarker={handleApproveMarker}
            onDeleteMarker={handleDeleteMarker}
            selectedLegendId={selectedLegendId}
            selectedLegendLabel={selectedLegend?.label}
            selectedLegendColor={selectedLegend?.color}
            onSelectLegendId={(id) => {
              setSelectedLegendId(id);
              // Select first valid candidate of newly selected symbol
              const first = markers.find((m) => 
                m.page_index === currentPageIndex && 
                m.legend_id === id &&
                (m.status === "user_verified" || m.status === "ai_verified" || m.status === "manual_added" || m.confidence_score >= confidenceThreshold)
              );
              if (first) setSelectedMarkerId(first.marker_id);
            }}
          />

          {imageUrl && (
            <BlueprintCanvas
              imageUrl={imageUrl}
              markers={markers.filter((m) => m.page_index === currentPageIndex)}
              legends={legends}
              selectedLegendId={selectedLegendId}
              selectedMarkerId={selectedMarkerId}
              onSelectMarkerId={(id) => setSelectedMarkerId(id)}
              activeTool={activeTool}
              confidenceThreshold={confidenceThreshold}
              rooms={rooms}
              excludedZones={currentExcludedZones}
              onSetExcludedZones={handleSetExcludedZones}
              onAutoDetectLegend={handleAutoDetectLegend}
              onClearExcludedZones={handleClearExcludedZone}
              onExitExcludeMode={() => setActiveTool("pan")}
              onAddManualMarker={handleAddManualMarker}
              onUpdateMarker={handleUpdateMarker}
              onDeleteMarker={handleDeleteMarker}
              onCompleteCrop={handleCompleteCrop}
              stageRef={stageRef}
            />
          )}
        </div>

        {/* Right Sidebar: QC Audit, Tally, Rooms, Exports */}
        <RightSidebar
          legends={legends}
          markers={markers}
          confidenceThreshold={confidenceThreshold}
          onThresholdChange={(v) => setConfidenceThreshold(v)}
          onBatchApproveHighConfidence={handleBatchApproveHighConfidence}
          onBatchApproveAIVerified={handleBatchApproveAIVerified}
          onRunAIAudit={handleOpenAIAudit}
          isAuditingAI={false}
          onExportExcel={handleExportExcel}
          onExportPdf={handleExportPdf}
          onDetectRoomsAI={handleDetectRoomsAI}
          rooms={rooms}
          isDetectingRooms={isDetectingRoomsAI}
          selectedLegend={selectedLegend}
          onSelectLegendId={(id) => {
            setSelectedLegendId(id);
            const first = markers.find((m) => 
              m.page_index === currentPageIndex && 
              m.legend_id === id &&
              (m.status === "user_verified" || m.status === "ai_verified" || m.status === "manual_added" || m.confidence_score >= confidenceThreshold)
            );
            if (first) setSelectedMarkerId(first.marker_id);
          }}
          onClearCandidatesForLegend={handleClearCandidatesForLegend}
          onApproveAllForLegend={handleApproveAllForLegend}
          lastSavedTime={lastSavedTime}
          isSaving={isSaving}
          onSaveSession={handleSaveSession}
          onRunFirstPassForSelected={handleRunFirstPassForSelected}
          isProcessingAI={isProcessingAI}
          onExportMasterTender={handleExportMasterTender}
          onOpenSymbolLibrary={() => setIsSymbolLibraryOpen(true)}
        />
      </div>

      {/* Symbol Creation & AI Auto-Count Modal */}
      <CreateLegendModal
        isOpen={cropModalOpen}
        onClose={() => setCropModalOpen(false)}
        cropCoords={pendingCropCoords}
        cropImageB64={pendingCropB64}
        onSaveAndRun={handleSaveAndRunAI}
        isProcessing={isProcessingAI}
        initialLegend={cropTargetLegend}
      />

      {/* AI Second-Pass Audit Modal */}
      {currentProject && (
        <AIAuditModal
          isOpen={aiAuditModalOpen}
          onClose={() => setAiAuditModalOpen(false)}
          legend={selectedLegend || null}
          markers={markers}
          filepath={currentProject.filepath}
          pageIndex={currentPageIndex}
          apiKey={apiKey}
          allLegends={legends}
          excludedZones={currentExcludedZones}
          confidenceThreshold={confidenceThreshold}
          onApplyResults={handleApplyAuditResults}
          onOpenApiKeyModal={() => setApiKeyModalOpen(true)}
          onOpenAuditLog={() => {
            setAiAuditModalOpen(false);
            setAuditLogModalOpen(true);
          }}
        />
      )}

      {/* AI Vision Audit Diagnostics & Inspection Log Modal */}
      <AIAuditLogModal
        isOpen={auditLogModalOpen}
        onClose={() => setAuditLogModalOpen(false)}
      />

      {/* Jeffway Electrical Symbol & Catalog Library Modal */}
      <SymbolLibraryModal
        isOpen={isSymbolLibraryOpen}
        onClose={() => setIsSymbolLibraryOpen(false)}
        onRecropSymbol={handleRecropFromLibrary}
      />

      {/* First-Pass AI Auto-Count Progress Overlay */}
      {isProcessingAI && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(10, 15, 30, 0.85)",
            backdropFilter: "blur(8px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#0F172A",
              border: "1px solid #3B82F6",
              boxShadow: "0 12px 40px rgba(0, 0, 0, 0.7), 0 0 24px rgba(59, 130, 246, 0.3)",
              borderRadius: 16,
              padding: "30px 36px",
              maxWidth: 480,
              width: "90%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "rgba(59, 130, 246, 0.12)",
                border: "2px solid rgba(59, 130, 246, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Loader2 size={32} color="#3B82F6" className="animate-spin" />
            </div>

            <div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    backgroundColor: selectedLegend?.color || "#3B82F6",
                  }}
                />
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#F8FAFC" }}>
                  1st-Pass AI Auto-Count in Progress
                </h3>
              </div>
              <p style={{ fontSize: 13, color: "#94A3B8" }}>
                Scanning blueprint sheet for <strong style={{ color: "#F8FAFC" }}>"{processingSymbolName}"</strong>
              </p>
            </div>

            {/* Pipeline progress steps */}
            <div
              style={{
                width: "100%",
                background: "#1E293B",
                borderRadius: 10,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                textAlign: "left",
                fontSize: 11,
                border: "1px solid #334155",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#10B981" }}>
                <span>✓</span>
                <span>Extract high-resolution symbol template crop</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#10B981" }}>
                <span>✓</span>
                <span>Mask excluded Electrical Legend zone (no duplicates)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#60A5FA" }}>
                <span className="animate-spin">⟳</span>
                <span>Multi-angle (0°, 90°, 180°, 270°) rotation template matching</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#94A3B8" }}>
                <span>○</span>
                <span>Non-Maximum Suppression (NMS) & room association</span>
              </div>
            </div>

            <span style={{ fontSize: 11, color: "#64748B" }}>
              High-speed vector-raster CV engine • Typically takes ~1 to 3 seconds
            </span>
          </div>
        </div>
      )}

      {/* OpenAI API Key Config Modal */}
      {apiKeyModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: 400 }}>
            <div className="modal-header">
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>OpenAI API Configuration</h3>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, color: "#94A3B8" }}>
                Enter the OpenAI API key from Jeffway to unlock GPT-4o Vision features: automated legend reading and architectural room segmentation.
              </p>
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="sk-..."
                  defaultValue={apiKey}
                  id="openai-key-input"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setApiKeyModalOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const input = document.getElementById("openai-key-input") as HTMLInputElement;
                  handleSaveApiKey(input.value);
                }}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default App;
