import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import {
  type ExcludedZone,
  type LegendItem,
  type LibrarySymbol,
  type Marker,
  type ProjectDetails,
  type ProjectSummary,
  type Rect,
  type ReviewFilter,
  type RoomZone,
  type Tool,
  type Verification,
} from "../lib/types";
import { isApproved, isCounted, isOpen, roomFor, sheetTitle, store } from "../lib/util";

export type LoadState = "loading" | "ready" | "offline" | "empty";
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface Busy {
  /** Label of the symbol currently being counted. */
  counting?: string;
  /** Progress through a whole-sheet count. */
  batch?: { done: number; total: number };
  legendScan?: boolean;
  rooms?: boolean;
}

export interface CropIntent {
  legend: LegendItem | null;
  rect: Rect;
  image?: string;
}

const HIGH_CONFIDENCE = 0.82;

export function useTakeoff() {
  const toast = useToast();

  const [load, setLoad] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string>("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  const [legends, setLegends] = useState<LegendItem[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [rooms, setRooms] = useState<RoomZone[]>([]);
  const [excluded, setExcluded] = useState<Record<string, ExcludedZone[]>>({});

  const [selectedLegendId, setSelectedLegendId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("open");
  const [threshold, setThresholdState] = useState<number>(() => store.get("pl.threshold.v2", 0.8));
  const [tool, setTool] = useState<Tool>("select");
  const [cropTarget, setCropTarget] = useState<LegendItem | null>(null);
  const [cropIntent, setCropIntent] = useState<CropIntent | null>(null);
  const [pendingRoom, setPendingRoom] = useState<Rect | null>(null);

  const [busy, setBusy] = useState<Busy>({});
  const [save, setSave] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [apiKey, setApiKeyState] = useState<string>(() => store.get("pl.openaiKey", ""));
  const [plots, setPlotsState] = useState<number>(1);
  const [exported, setExported] = useState(false);
  const [library, setLibrary] = useState<LibrarySymbol[]>([]);

  const hydrated = useRef(false);

  const setThreshold = (v: number) => {
    setThresholdState(v);
    store.set("pl.threshold.v2", v);
  };
  const setApiKey = (k: string) => {
    setApiKeyState(k);
    store.set("pl.openaiKey", k);
  };
  const setPlots = (n: number) => {
    const v = Math.max(1, Math.round(n) || 1);
    setPlotsState(v);
    if (project) store.set(`pl.plots.${project.project_id}`, v);
  };

  // ---------- Loading ----------
  const openProject = useCallback(
    async (summary: ProjectSummary, at?: { page?: number; markerId?: string }) => {
      setLoad("loading");
      hydrated.current = false;
      try {
        const d = await api.projectDetails(summary.project_id, summary.filepath);
        setProject({ ...d, name: summary.name || d.name, project_id: summary.project_id });
        setLegends(d.legends ?? []);
        setMarkers(d.markers ?? []);
        setRooms(d.rooms ?? []);
        setExcluded(d.excluded_zones ?? {});
        setSelectedMarkerId(null);
        setSelectedLegendId(null);
        setPlotsState(store.get(`pl.plots.${summary.project_id}`, 1));
        const elec = d.pages.filter((p) => p.is_electrical);
        const withMarks = elec.find((p) => (d.markers ?? []).some((m) => m.page_index === p.page_index));
        const first =
          withMarks ??
          elec.find((p) => /ground floor/i.test(p.title)) ??
          elec[0] ??
          d.pages[0];
        setPageIndex(at?.page ?? first?.page_index ?? 0);
        if (at?.markerId) {
          setSelectedMarkerId(at.markerId);
          setFilter("all");
        }
        store.set("pl.lastProject", summary.project_id);
        setSave("idle");
        setLoad("ready");
        setTimeout(() => (hydrated.current = true), 0);
      } catch (e) {
        setLoadError((e as Error).message);
        setLoad("offline");
      }
    },
    [],
  );

  const refreshProjects = useCallback(async () => {
    setLoad("loading");
    try {
      const list = await api.listProjects();
      setProjects(list);
      if (list.length === 0) {
        setLoad("empty");
        return;
      }
      const last = store.get<string | null>("pl.lastProject", null);
      await openProject(list.find((p) => p.project_id === last) ?? list[0]);
    } catch (e) {
      setLoadError((e as Error).message);
      setLoad("offline");
    }
  }, [openProject]);

  useEffect(() => {
    refreshProjects();
    api.library().then(setLibrary).catch(() => {});
  }, [refreshProjects]);

  const uploadPdf = async (file: File) => {
    try {
      toast({ tone: "info", title: `Uploading ${file.name}…` });
      const meta = await api.uploadPdf(file);
      const list = await api.listProjects();
      setProjects(list);
      await openProject(meta);
      toast({ tone: "success", title: "Tender pack added", body: meta.name });
    } catch (e) {
      toast({ tone: "error", title: "Upload failed", body: (e as Error).message });
    }
  };

  // ---------- Derived ----------
  const page = project?.pages.find((p) => p.page_index === pageIndex) ?? null;
  const zones = useMemo(() => excluded[String(pageIndex)] ?? [], [excluded, pageIndex]);
  const pageRooms = useMemo(
    () => rooms.filter((r) => r.page_index == null || r.page_index === pageIndex),
    [rooms, pageIndex],
  );
  const selectedLegend = legends.find((l) => l.legend_id === selectedLegendId) ?? null;
  const pageMarkers = useMemo(() => markers.filter((m) => m.page_index === pageIndex), [markers, pageIndex]);
  const visibleMarkers = useMemo(
    () => pageMarkers.filter((m) => isCounted(m, threshold)),
    [pageMarkers, threshold],
  );

  const reviewList = useMemo(() => {
    const base = visibleMarkers.filter((m) => !selectedLegendId || m.legend_id === selectedLegendId);
    const list =
      filter === "open"
        ? base.filter(isOpen)
        : filter === "ai"
          ? base.filter((m) => m.status === "ai_verified")
          : filter === "approved"
            ? base.filter(isApproved)
            : base;
    // Reading order: top-to-bottom bands, then left-to-right
    return [...list].sort((a, b) => Math.round(a.y / 120) - Math.round(b.y / 120) || a.x - b.x);
  }, [visibleMarkers, selectedLegendId, filter]);

  const selectedMarker = markers.find((m) => m.marker_id === selectedMarkerId) ?? null;

  const counts = useMemo(() => {
    const map = new Map<string, { sheet: number; total: number; approved: number; open: number }>();
    for (const l of legends) map.set(l.legend_id, { sheet: 0, total: 0, approved: 0, open: 0 });
    for (const m of markers) {
      const c = map.get(m.legend_id);
      if (!c || !isCounted(m, threshold)) continue;
      c.total++;
      if (m.page_index === pageIndex) c.sheet++;
      if (isApproved(m)) c.approved++;
      else if (isOpen(m)) c.open++;
    }
    return map;
  }, [legends, markers, threshold, pageIndex]);

  const sheetStats = useMemo(() => {
    const s = { approved: 0, ai: 0, open: 0, total: 0 };
    for (const m of visibleMarkers) {
      s.total++;
      if (isApproved(m)) s.approved++;
      else if (m.status === "ai_verified") s.ai++;
      else s.open++;
    }
    return s;
  }, [visibleMarkers]);

  const markersOnPage = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of markers) if (isCounted(m, threshold)) map.set(m.page_index, (map.get(m.page_index) ?? 0) + 1);
    return map;
  }, [markers, threshold]);

  // ---------- Persistence ----------
  const saveNow = useCallback(async () => {
    if (!project) return;
    setSave("saving");
    try {
      await api.saveState({ project_id: project.project_id, legends, markers, rooms, excluded_zones: excluded });
      setSave("saved");
      setSavedAt(new Date());
    } catch (e) {
      setSave("error");
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
    }
  }, [project, legends, markers, rooms, excluded, toast]);

  useEffect(() => {
    if (!hydrated.current || !project) return;
    setSave("dirty");
    const t = setTimeout(saveNow, 2000);
    return () => clearTimeout(t);
    // saveNow changes whenever the data does; that is the trigger we want
  }, [legends, markers, rooms, excluded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect the legend table on a sheet the first time it is opened
  useEffect(() => {
    if (!project || load !== "ready") return;
    const key = String(pageIndex);
    if (excluded[key]?.length) return;
    let alive = true;
    api.legendZone(project.filepath, pageIndex).then((z) => {
      if (alive && z) setExcluded((prev) => (prev[key]?.length ? prev : { ...prev, [key]: [{ ...z, label: "Legend" }] }));
    });
    return () => {
      alive = false;
    };
  }, [project, pageIndex, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Navigation ----------
  const goToPage = (idx: number) => {
    setPageIndex(idx);
    setSelectedMarkerId(null);
  };

  const step = useCallback(
    (dir: 1 | -1) => {
      if (reviewList.length === 0) return;
      const i = reviewList.findIndex((m) => m.marker_id === selectedMarkerId);
      const next = i < 0 ? (dir === 1 ? 0 : reviewList.length - 1) : (i + dir + reviewList.length) % reviewList.length;
      setSelectedMarkerId(reviewList[next].marker_id);
    },
    [reviewList, selectedMarkerId],
  );

  /** After the current marker leaves the list, land on the one that took its place. */
  const advanceFrom = (id: string) => {
    const i = reviewList.findIndex((m) => m.marker_id === id);
    const rest = reviewList.filter((m) => m.marker_id !== id);
    const stays = filter === "all";
    if (stays) {
      const nxt = reviewList[(i + 1) % reviewList.length];
      setSelectedMarkerId(nxt?.marker_id ?? null);
    } else {
      setSelectedMarkerId(rest.length ? rest[Math.min(Math.max(i, 0), rest.length - 1)].marker_id : null);
    }
  };

  const selectMarker = (id: string | null) => {
    setSelectedMarkerId(id);
    if (!id) return;
    const m = markers.find((x) => x.marker_id === id);
    if (m && selectedLegendId && m.legend_id !== selectedLegendId) setSelectedLegendId(m.legend_id);
  };

  // ---------- Review actions ----------
  const approve = (id = selectedMarkerId) => {
    if (!id) return;
    setMarkers((prev) => prev.map((m) => (m.marker_id === id ? { ...m, status: "user_verified" } : m)));
    advanceFrom(id);
  };

  const reject = (id = selectedMarkerId) => {
    if (!id) return;
    const removed = markers.find((m) => m.marker_id === id);
    if (!removed) return;
    setMarkers((prev) => prev.filter((m) => m.marker_id !== id));
    advanceFrom(id);
    toast({
      tone: "info",
      title: "Mark removed",
      action: { label: "Undo", run: () => setMarkers((prev) => [...prev, removed]) },
    });
  };

  const addManual = (x: number, y: number) => {
    if (!selectedLegend) {
      toast({ tone: "info", title: "Pick a symbol first", body: "Choose which symbol you're placing from the Symbols list." });
      return;
    }
    const size = selectedLegend.template_crop_coords
      ? Math.max(selectedLegend.template_crop_coords.width, selectedLegend.template_crop_coords.height)
      : 32;
    const m: Marker = {
      marker_id: `mk_man_${Date.now()}`,
      legend_id: selectedLegend.legend_id,
      x: x - size / 2,
      y: y - size / 2,
      width: size,
      height: size,
      confidence_score: 1,
      status: "manual_added",
      room: roomFor(x, y, pageRooms),
      page_index: pageIndex,
      page_number: pageIndex + 1,
    };
    setMarkers((prev) => [...prev, m]);
    setSelectedMarkerId(m.marker_id);
  };

  const bulk = (pred: (m: Marker) => boolean, label: string) => {
    const n = markers.filter(pred).length;
    setMarkers((prev) => prev.map((m) => (pred(m) ? { ...m, status: "user_verified" } : m)));
    toast({ tone: n ? "success" : "info", title: n ? `Approved ${n} ${label}` : "Nothing to approve" });
  };

  const approveHighConfidence = () =>
    bulk(
      (m) => m.page_index === pageIndex && m.status === "ai_unverified" && m.confidence_score >= HIGH_CONFIDENCE,
      "high-confidence marks",
    );
  const approveAIChecked = () => bulk((m) => m.page_index === pageIndex && m.status === "ai_verified", "AI-checked marks");
  const approveAllForLegend = (id: string) =>
    bulk(
      (m) => m.page_index === pageIndex && m.legend_id === id && !isApproved(m) && isCounted(m, threshold),
      "marks",
    );
  const clearOpenForLegend = (id: string) => {
    const before = markers;
    setMarkers((prev) => prev.filter((m) => !(m.page_index === pageIndex && m.legend_id === id && isOpen(m))));
    toast({ tone: "info", title: "Cleared unreviewed marks", action: { label: "Undo", run: () => setMarkers(before) } });
  };

  /** Remove every mark (approved or not) on this sheet, or in the whole house type. Symbols and samples are kept. */
  const clearMarks = (scope: "sheet" | "all") => {
    const before = markers;
    const n = scope === "sheet" ? markers.filter((m) => m.page_index === pageIndex).length : markers.length;
    setMarkers((prev) => (scope === "sheet" ? prev.filter((m) => m.page_index !== pageIndex) : []));
    setLegends((prev) => prev.map((l) => ({ ...l, count: 0 })));
    setSelectedMarkerId(null);
    toast({
      tone: "info",
      title: n ? `Cleared ${n} marks ${scope === "sheet" ? "on this sheet" : "in this house type"}` : "No marks to clear",
      action: n ? { label: "Undo", run: () => setMarkers(before) } : undefined,
    });
  };

  // ---------- Counting ----------
  const countLegend = async (legend: LegendItem, opts: { quiet?: boolean } = {}): Promise<number | null> => {
    if (!project) return null;
    if (!legend.template_crop_coords && !legend.template_image_b64) {
      if (!opts.quiet) {
        setCropTarget(legend);
        setSelectedLegendId(legend.legend_id);
        setTool("crop");
        toast({ tone: "info", title: `Draw a box around one ${legend.label}`, body: "Plotline uses it as the sample to count from." });
      }
      return null;
    }
    setBusy((b) => ({ ...b, counting: legend.label }));
    try {
      const res = await api.autoCount({
        project_id: project.project_id,
        filepath: project.filepath,
        page_index: pageIndex,
        legend,
        min_confidence: 0.5,
        excluded_zones: zones.length ? zones : undefined,
      });
      const key = String(pageIndex);
      if (res.legend_zone && !zones.length) {
        setExcluded((prev) => ({ ...prev, [key]: [{ ...res.legend_zone!, label: "Legend" }] }));
      }
      const found = res.markers.map((m) => ({
        ...m,
        page_index: pageIndex,
        page_number: pageIndex + 1,
        room: roomFor(m.x + m.width / 2, m.y + m.height / 2, pageRooms),
      }));
      setMarkers((prev) => {
        // Keep confirmed marks for this symbol on this sheet; replace its unreviewed candidates
        const keep = prev.filter(
          (m) =>
            m.legend_id !== legend.legend_id ||
            m.page_index !== pageIndex ||
            isApproved(m) ||
            m.status === "ai_verified",
        );
        const confirmed = keep.filter((m) => m.legend_id === legend.legend_id && m.page_index === pageIndex);
        const fresh = found.filter((n) => {
          const ncx = n.x + n.width / 2;
          const ncy = n.y + n.height / 2;
          const r = Math.max(30, Math.max(n.width, n.height) * 1.45);
          return !confirmed.some((e) => Math.hypot(ncx - (e.x + e.width / 2), ncy - (e.y + e.height / 2)) < r);
        });
        return [...keep, ...fresh];
      });
      setLegends((prev) => prev.map((l) => (l.legend_id === legend.legend_id ? { ...l, count: found.length } : l)));
      if (!opts.quiet) {
        setSelectedLegendId(legend.legend_id);
        const hasReview = found.some((m) => m.status === "needs_review");
        setFilter(hasReview ? "open" : "all");
        setSelectedMarkerId(found.find((m) => m.confidence_score >= threshold)?.marker_id ?? null);
        toast({
          tone: "success",
          title: `Found ${found.length} × ${legend.label}`,
          body: found.length ? "Review them with A to approve, X to reject." : "Try a tighter sample box if you expected some.",
        });
      }
      return found.length;
    } catch (e) {
      toast({ tone: "error", title: `Couldn't count ${legend.label}`, body: (e as Error).message });
      return null;
    } finally {
      setBusy((b) => ({ ...b, counting: undefined }));
    }
  };

  const countAllOnSheet = async () => {
    const ready = legends.filter((l) => l.template_crop_coords || l.template_image_b64);
    if (!ready.length) {
      toast({ tone: "info", title: "No symbols have a sample yet", body: "Crop one example of each symbol first (C)." });
      return;
    }
    let total = 0;
    for (let i = 0; i < ready.length; i++) {
      setBusy((b) => ({ ...b, batch: { done: i, total: ready.length } }));
      total += (await countLegend(ready[i], { quiet: true })) ?? 0;
    }
    setBusy((b) => ({ ...b, batch: undefined }));
    setFilter("open");
    setSelectedMarkerId(null);
    toast({ tone: "success", title: `Counted ${ready.length} symbols on this sheet`, body: `${total} marks found.` });
  };

  // ---------- Symbols ----------
  const startCrop = (legend: LegendItem | null) => {
    setCropTarget(legend);
    if (legend) setSelectedLegendId(legend.legend_id);
    setTool("crop");
  };

  const finishCrop = (rect: Rect, image?: string) => {
    setCropIntent({ legend: cropTarget, rect, image });
    setTool("select");
  };

  const saveSymbol = async (legend: LegendItem, runCount: boolean) => {
    setLegends((prev) =>
      prev.some((l) => l.legend_id === legend.legend_id)
        ? prev.map((l) => (l.legend_id === legend.legend_id ? legend : l))
        : [...prev, legend],
    );
    setSelectedLegendId(legend.legend_id);
    setCropIntent(null);
    setCropTarget(null);
    // Keep the master library's sample in step so new projects inherit it
    if (legend.template_image_b64) {
      try {
        const lib = await api.library();
        let hit = false;
        const next = lib.map((it) => {
          if (it.legend_id === legend.legend_id || it.cad_label === legend.label) {
            hit = true;
            return { ...it, template_crop_coords: legend.template_crop_coords, template_image_b64: legend.template_image_b64 };
          }
          return it;
        });
        if (hit) {
          await api.saveLibrary(next);
          setLibrary(next);
        }
      } catch {
        /* library sync is best-effort */
      }
    }
    if (runCount) await countLegend(legend);
  };

  const updateLegend = (id: string, patch: Partial<LegendItem>) =>
    setLegends((prev) => prev.map((l) => (l.legend_id === id ? { ...l, ...patch } : l)));

  const deleteLegend = (id: string) => {
    const before = { legends, markers };
    setLegends((prev) => prev.filter((l) => l.legend_id !== id));
    setMarkers((prev) => prev.filter((m) => m.legend_id !== id));
    if (selectedLegendId === id) setSelectedLegendId(null);
    toast({
      tone: "info",
      title: "Symbol removed",
      action: {
        label: "Undo",
        run: () => {
          setLegends(before.legends);
          setMarkers(before.markers);
        },
      },
    });
  };

  const addFromLibrary = (it: LibrarySymbol) => {
    const id = it.legend_id || it.symbol_id || `leg_${Date.now()}`;
    if (legends.some((l) => l.legend_id === id)) {
      setSelectedLegendId(id);
      return;
    }
    const l: LegendItem = {
      legend_id: id,
      label: it.label || it.cad_label || it.sheet_desc || "Symbol",
      color: it.color || "#E8590C",
      category: it.category || "Power & Accessories",
      fix_stage: it.fix_stage || "2nd Fix",
      manufacturer: it.manufacturer || "",
      part_code: it.part_code || "",
      template_crop_coords: it.template_crop_coords,
      template_image_b64: it.template_image_b64,
    };
    setLegends((prev) => [...prev, l]);
    setSelectedLegendId(id);
    toast({ tone: "success", title: `Added ${l.label}` });
  };

  const saveLibrary = async (next: LibrarySymbol[]) => {
    try {
      await api.saveLibrary(next);
      setLibrary(next);
      toast({ tone: "success", title: "Symbol library saved" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save library", body: (e as Error).message });
    }
  };

  const scanLegendAI = async () => {
    if (!project) return;
    setBusy((b) => ({ ...b, legendScan: true }));
    try {
      const res = await api.scanLegend({ filepath: project.filepath, page_index: pageIndex, api_key: apiKey || undefined });
      const fresh: LegendItem[] = (res.symbols ?? [])
        .filter((s) => !legends.some((l) => l.label.toLowerCase() === (s.label ?? "").toLowerCase()))
        .map((s, i) => ({
          legend_id: `leg_ai_${Date.now()}_${i}`,
          label: s.label || "Symbol",
          color: s.suggested_color || "#3E63DD",
          category: s.category || "Power & Accessories",
          fix_stage: (s.fix_stage as LegendItem["fix_stage"]) || "2nd Fix",
          manufacturer: s.manufacturer || "",
          part_code: s.part_code || "",
        }));
      setLegends((prev) => [...prev, ...fresh]);
      toast({
        tone: "success",
        title: fresh.length ? `Read ${fresh.length} new symbols from the legend` : "No new symbols found in the legend",
        body: fresh.length ? "Crop a sample of each before counting." : undefined,
      });
    } catch (e) {
      const msg = (e as Error).message;
      toast({ tone: "error", title: "Couldn't read the legend", body: msg });
      if (/api key/i.test(msg)) return "needs-key" as const;
    } finally {
      setBusy((b) => ({ ...b, legendScan: false }));
    }
  };

  // ---------- Zones & rooms ----------
  const addExcluded = (r: Rect) => {
    const key = String(pageIndex);
    setExcluded((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), { ...r, label: "Excluded" }] }));
  };
  const removeExcluded = (i: number) => {
    const key = String(pageIndex);
    setExcluded((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((_, j) => j !== i) }));
  };
  const detectLegendZone = async () => {
    if (!project) return;
    const z = await api.legendZone(project.filepath, pageIndex);
    if (z) {
      setExcluded((prev) => ({ ...prev, [String(pageIndex)]: [{ ...z, label: "Legend" }] }));
      toast({ tone: "success", title: "Legend area found and excluded from counts" });
    } else {
      toast({ tone: "info", title: "No legend table found on this sheet", body: "Draw an exclusion box with E instead." });
    }
  };

  const reassignRooms = (list: RoomZone[]) =>
    setMarkers((prev) =>
      prev.map((m) => {
        const rs = list.filter((r) => r.page_index == null || r.page_index === m.page_index);
        return { ...m, room: roomFor(m.x + m.width / 2, m.y + m.height / 2, rs) };
      }),
    );

  const addRoom = (name: string, r: Rect) => {
    const next = [...rooms, { ...r, name, page_index: pageIndex }];
    setRooms(next);
    reassignRooms(next);
    setPendingRoom(null);
  };
  const removeRoom = (room: RoomZone) => {
    const next = rooms.filter((r) => r !== room);
    setRooms(next);
    reassignRooms(next);
  };
  const detectRoomsAI = async () => {
    if (!project) return;
    setBusy((b) => ({ ...b, rooms: true }));
    try {
      const res = await api.detectRooms({ filepath: project.filepath, page_index: pageIndex, api_key: apiKey || undefined });
      const found = (res.rooms ?? []).map((r) => ({ ...r, page_index: pageIndex }));
      const next = [...rooms.filter((r) => r.page_index !== pageIndex && r.page_index != null), ...found];
      setRooms(next);
      reassignRooms(next);
      toast({ tone: "success", title: `Found ${found.length} rooms` });
    } catch (e) {
      const msg = (e as Error).message;
      toast({ tone: "error", title: "Couldn't detect rooms", body: msg });
      if (/api key/i.test(msg)) return "needs-key" as const;
    } finally {
      setBusy((b) => ({ ...b, rooms: false }));
    }
  };

  // ---------- AI check ----------
  const runAICheck = async (legend: LegendItem, targets: Marker[]) => {
    if (!project) throw new Error("No project open");
    const res = await api.verifyCandidates({
      filepath: project.filepath,
      page_index: pageIndex,
      legend,
      markers: targets,
      api_key: apiKey || undefined,
      all_legends: legends,
      excluded_zones: zones,
    });
    return res.verifications ?? [];
  };

  const applyAICheck = (results: Verification[], approveDirectly: boolean) => {
    const byId = new Map(results.map((r) => [r.marker_id, r]));
    const kept = results.filter((r) => r.is_valid).length;
    const dropped = results.length - kept;
    setMarkers((prev) =>
      prev
        .filter((m) => {
          const r = byId.get(m.marker_id);
          return !(r && !r.is_valid);
        })
        .map((m) => {
          const r = byId.get(m.marker_id);
          if (!r) return m;
          return {
            ...m,
            status: approveDirectly ? "user_verified" : "ai_verified",
            confidence_score: r.confidence ?? m.confidence_score,
            metadata: { ...m.metadata, ai_audit_reason: r.reason, ai_audit_confidence: r.confidence },
          };
        }),
    );
    toast({ tone: "success", title: `AI kept ${kept}, removed ${dropped}` });
    setSelectedMarkerId(null);
  };

  // ---------- Export ----------
  const exportAs = async (kind: "tender" | "takeoff" | "pdf") => {
    if (!project) return;
    const payload = {
      project_id: project.project_id,
      project_name: project.name,
      filepath: project.filepath,
      legends,
      markers: markers.filter((m) => isCounted(m, threshold)),
    };
    try {
      toast({ tone: "info", title: "Preparing export…" });
      if (kind === "tender") await api.exportTender(payload);
      else if (kind === "takeoff") await api.exportTakeoff(payload);
      else await api.exportPdf(payload);
      setExported(true);
      toast({ tone: "success", title: "Export downloaded" });
    } catch (e) {
      toast({ tone: "error", title: "Export failed", body: (e as Error).message });
    }
  };

  const pageLabel = page ? sheetTitle(page) : "";

  return {
    // data
    load, loadError, projects, project, page, pageIndex, pageLabel, legends, markers, rooms, pageRooms, zones,
    library, selectedLegend, selectedLegendId, selectedMarker, selectedMarkerId, reviewList, visibleMarkers,
    pageMarkers, counts, sheetStats, markersOnPage, filter, threshold, tool, cropTarget, cropIntent, pendingRoom,
    busy, save, savedAt, apiKey, plots, exported,
    // setters
    setFilter, setThreshold, setTool, setSelectedLegendId, setApiKey, setPlots, setCropIntent, setPendingRoom,
    setCropTarget, setLibraryState: setLibrary,
    // actions
    refreshProjects, openProject, uploadPdf, goToPage, step, selectMarker, approve, reject, addManual,
    approveHighConfidence, approveAIChecked, approveAllForLegend, clearOpenForLegend, clearMarks, countLegend, countAllOnSheet,
    startCrop, finishCrop, saveSymbol, updateLegend, deleteLegend, addFromLibrary, saveLibrary, scanLegendAI,
    addExcluded, removeExcluded, detectLegendZone, addRoom, removeRoom, detectRoomsAI, runAICheck, applyAICheck,
    exportAs, saveNow,
  };
}

export type Takeoff = ReturnType<typeof useTakeoff>;
