import React, { useRef, useState, useEffect, useMemo } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Circle, Line, Text, Group } from "react-konva";
import type { Marker, LegendItem, ToolMode, RoomZone, ExcludedZone } from "../../types/takeoff";
import { Trash2, ShieldCheck, Ban, Sparkles, Check } from "lucide-react";

interface Props {
  imageUrl: string;
  markers: Marker[];
  legends: LegendItem[];
  selectedLegendId?: string;
  selectedMarkerId?: string | null;
  onSelectMarkerId?: (id: string | null) => void;
  activeTool: ToolMode;
  confidenceThreshold: number; // e.g. 0.70
  rooms: RoomZone[];
  excludedZones?: ExcludedZone[];
  onSetExcludedZones?: (zones: ExcludedZone[]) => void;
  onAutoDetectLegend?: () => void;
  onClearExcludedZones?: () => void;
  onExitExcludeMode?: () => void;
  onAddManualMarker: (x: number, y: number) => void;
  onUpdateMarker: (markerId: string, updates: Partial<Marker>) => void;
  onDeleteMarker: (markerId: string) => void;
  onCompleteCrop: (coords: { x: number; y: number; width: number; height: number }, imageB64?: string) => void;
  stageRef: React.RefObject<any>;
}

export const BlueprintCanvas: React.FC<Props> = ({
  imageUrl,
  markers,
  legends,
  selectedLegendId,
  selectedMarkerId,
  onSelectMarkerId,
  activeTool,
  confidenceThreshold,
  rooms,
  excludedZones = [],
  onSetExcludedZones,
  onAutoDetectLegend,
  onClearExcludedZones,
  onExitExcludeMode,
  onAddManualMarker,
  onUpdateMarker,
  onDeleteMarker,
  onCompleteCrop,
  stageRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  // Tool state: Cropping
  const [isCropping, setIsCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropCurrent, setCropCurrent] = useState<{ x: number; y: number } | null>(null);

  // Tool state: Excluding Legend Zone
  const [isDrawingExclude, setIsDrawingExclude] = useState(false);
  const [excludeStart, setExcludeStart] = useState<{ x: number; y: number } | null>(null);
  const [excludeCurrent, setExcludeCurrent] = useState<{ x: number; y: number } | null>(null);

  // Tool state: Measuring
  const [measurePoints, setMeasurePoints] = useState<number[]>([]);

  // Selected marker for review
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const effectiveSelectedId = selectedMarkerId !== undefined ? selectedMarkerId : internalSelectedId;
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

  const setSelectedMarkerId = (id: string | null) => {
    setInternalSelectedId(id);
    if (onSelectMarkerId) onSelectMarkerId(id);
  };

  // Center and zoom when selectedMarkerId is targeted externally
  useEffect(() => {
    if (!selectedMarkerId) return;
    const target = markers.find((m) => m.marker_id === selectedMarkerId);
    if (target && containerRef.current) {
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      const zoom = 1.65; // Clear inspection zoom
      const mx = target.x + (target.width || 30) / 2;
      const my = target.y + (target.height || 30) / 2;
      setStageScale(zoom);
      setStagePos({
        x: cw / 2 - mx * zoom,
        y: ch / 2 - my * zoom,
      });
    }
  }, [selectedMarkerId]);

  // Load blueprint image
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;
    img.onload = () => {
      setImage(img);
      // Auto-fit to container on initial load
      if (containerRef.current) {
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight;
        const scale = Math.min(cw / img.width, ch / img.height) * 0.95;
        setStageScale(scale);
        setStagePos({
          x: (cw - img.width * scale) / 2,
          y: (ch - img.height * scale) / 2,
        });
      }
    };
  }, [imageUrl]);

  // Window resize observer
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Map of legends by ID
  const legendMap = useMemo(() => {
    const map = new Map<string, LegendItem>();
    legends.forEach((l) => map.set(l.legend_id, l));
    return map;
  }, [legends]);

  // Only display markers for the active selected symbol by default to reduce clutter
  const [isolateActiveSymbol, setIsolateActiveSymbol] = useState(true);

  // Resolve effective selected legend: ensure it always matches a valid legend
  const effectiveLegendId = useMemo(() => {
    if (selectedLegendId && legends.some((l) => l.legend_id === selectedLegendId)) {
      return selectedLegendId;
    }
    return legends[0]?.legend_id || selectedLegendId || "";
  }, [selectedLegendId, legends]);

  // Filter markers strictly by selected active symbol when isolated
  const visibleMarkers = useMemo(() => {
    return markers.filter((m) => {
      if (isolateActiveSymbol && effectiveLegendId && m.legend_id !== effectiveLegendId) {
        return false;
      }
      if (m.status === "user_verified" || m.status === "ai_verified" || m.status === "manual_added") {
        return true;
      }
      return m.confidence_score === undefined || m.confidence_score === null || m.confidence_score >= confidenceThreshold;
    });
  }, [markers, effectiveLegendId, isolateActiveSymbol, confidenceThreshold]);

  // Selected marker object
  const activeMarker = useMemo(() => {
    return markers.find((m) => m.marker_id === effectiveSelectedId) || null;
  }, [markers, effectiveSelectedId]);

  // Wheel zoom around cursor
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.12;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.15, Math.min(12, newScale));

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    setStageScale(clampedScale);
    setStagePos({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  };

  // Mouse interactions
  const handleMouseDown = (e: any) => {
    const stage = stageRef.current;
    if (!stage) return;

    // Deselect marker if clicked empty canvas
    if (e.target === stage || e.target.name() === "blueprint-image") {
      setSelectedMarkerId(null);
    }

    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = transform.point(stage.getPointerPosition());

    if (activeTool === "crop_legend") {
      setIsCropping(true);
      setCropStart({ x: pos.x, y: pos.y });
      setCropCurrent({ x: pos.x, y: pos.y });
    } else if (activeTool === "exclude_zone") {
      setIsDrawingExclude(true);
      setExcludeStart({ x: pos.x, y: pos.y });
      setExcludeCurrent({ x: pos.x, y: pos.y });
    } else if (activeTool === "manual_add") {
      onAddManualMarker(pos.x, pos.y);
    } else if (activeTool === "measure") {
      if (measurePoints.length === 0 || measurePoints.length >= 4) {
        setMeasurePoints([pos.x, pos.y]);
      } else {
        setMeasurePoints([measurePoints[0], measurePoints[1], pos.x, pos.y]);
      }
    }
  };

  const handleMouseMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = transform.point(stage.getPointerPosition());

    if (isCropping && cropStart) {
      setCropCurrent({ x: pos.x, y: pos.y });
    } else if (isDrawingExclude && excludeStart) {
      setExcludeCurrent({ x: pos.x, y: pos.y });
    }
  };

  const handleMouseUp = () => {
    if (isCropping && cropStart && cropCurrent) {
      setIsCropping(false);
      const x = Math.min(cropStart.x, cropCurrent.x);
      const y = Math.min(cropStart.y, cropCurrent.y);
      const w = Math.abs(cropCurrent.x - cropStart.x);
      const h = Math.abs(cropCurrent.y - cropStart.y);

      if (w > 12 && h > 12 && image) {
        // Extract base64 thumbnail from offscreen canvas
        const offCanvas = document.createElement("canvas");
        offCanvas.width = w;
        offCanvas.height = h;
        const ctx = offCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
          const b64 = offCanvas.toDataURL("image/png");
          onCompleteCrop({ x, y, width: w, height: h }, b64);
        } else {
          onCompleteCrop({ x, y, width: w, height: h });
        }
      }
      setCropStart(null);
      setCropCurrent(null);
    } else if (isDrawingExclude && excludeStart && excludeCurrent) {
      setIsDrawingExclude(false);
      const x = Math.min(excludeStart.x, excludeCurrent.x);
      const y = Math.min(excludeStart.y, excludeCurrent.y);
      const w = Math.abs(excludeCurrent.x - excludeStart.x);
      const h = Math.abs(excludeCurrent.y - excludeStart.y);

      if (w > 15 && h > 15 && onSetExcludedZones) {
        onSetExcludedZones([{ x, y, width: w, height: h, label: "Legend Excluded (Manual)" }]);
      }
      setExcludeStart(null);
      setExcludeCurrent(null);
    }
  };

  // Compute crop box bounds for rendering
  const cropBox = useMemo(() => {
    if (!cropStart || !cropCurrent) return null;
    return {
      x: Math.min(cropStart.x, cropCurrent.x),
      y: Math.min(cropStart.y, cropCurrent.y),
      width: Math.abs(cropCurrent.x - cropStart.x),
      height: Math.abs(cropCurrent.y - cropStart.y),
    };
  }, [cropStart, cropCurrent]);

  return (
    <div
      ref={containerRef}
      className="center-stage"
      style={{
        position: "relative",
        cursor:
          activeTool === "pan"
            ? "grab"
            : activeTool === "crop_legend" || activeTool === "exclude_zone"
            ? "crosshair"
            : activeTool === "manual_add"
            ? "copy"
            : activeTool === "measure"
            ? "cell"
            : "default",
      }}
    >
      {/* Floating Helper Banner when in Manual Exclude Mode */}
      {activeTool === "exclude_zone" && (
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            backgroundColor: "rgba(15, 23, 42, 0.94)",
            border: "1px solid rgba(239, 68, 68, 0.45)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
            borderRadius: 8,
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            backdropFilter: "blur(10px)",
            pointerEvents: "auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#EF4444", fontWeight: 700, fontSize: 12 }}>
            <Ban size={15} />
            <span>EXCLUDE LEGEND</span>
          </div>
          <span style={{ fontSize: 12, color: "#94A3B8" }}>
            Click & drag a rectangle over the Electrical Legend column to exclude it.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {onAutoDetectLegend && (
              <button
                onClick={onAutoDetectLegend}
                style={{
                  backgroundColor: "rgba(56, 189, 248, 0.15)",
                  border: "1px solid #38BDF8",
                  color: "#38BDF8",
                  borderRadius: 4,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
                title="Auto-detect the legend table boundaries automatically"
              >
                <Sparkles size={13} />
                <span>Auto-Detect</span>
              </button>
            )}
            {excludedZones.length > 0 && onClearExcludedZones && (
              <button
                onClick={onClearExcludedZones}
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#F87171",
                  borderRadius: 4,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Trash2 size={13} />
                <span>Clear</span>
              </button>
            )}
            <button
              onClick={() => onExitExcludeMode && onExitExcludeMode()}
              style={{
                backgroundColor: "#10B981",
                border: "none",
                color: "#FFFFFF",
                borderRadius: 4,
                padding: "4px 12px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Check size={13} />
              <span>Done</span>
            </button>
          </div>
        </div>
      )}

      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={activeTool === "pan"}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
      >
        {/* Layer 1: Blueprint Raster Image */}
        <Layer>
          {image && (
            <KonvaImage
              name="blueprint-image"
              image={image}
              width={image.width}
              height={image.height}
            />
          )}
        </Layer>

        {/* Layer: Excluded Legend Zones (Filtered from Auto-Count & AI) */}
        <Layer listening={false}>
          {excludedZones.map((ez, idx) => (
            <Group key={`ez_${idx}`}>
              <Rect
                x={ez.x}
                y={ez.y}
                width={ez.width}
                height={ez.height}
                fill="rgba(239, 68, 68, 0.12)"
                stroke="#EF4444"
                strokeWidth={2.5}
                dash={[10, 6]}
                cornerRadius={4}
              />
              <Rect
                x={ez.x}
                y={Math.max(0, ez.y - 26)}
                width={Math.min(ez.width, 340)}
                height={24}
                fill="#EF4444"
                cornerRadius={[4, 4, 0, 0]}
              />
              <Text
                x={ez.x + 8}
                y={Math.max(0, ez.y - 20)}
                text="🚫 EXCLUDED LEGEND (Symbols inside ignored)"
                fontSize={11}
                fontFamily="JetBrains Mono, monospace"
                fontStyle="bold"
                fill="#FFFFFF"
              />
            </Group>
          ))}

          {/* Active drawing preview */}
          {isDrawingExclude && excludeStart && excludeCurrent && (
            <Group>
              <Rect
                x={Math.min(excludeStart.x, excludeCurrent.x)}
                y={Math.min(excludeStart.y, excludeCurrent.y)}
                width={Math.abs(excludeCurrent.x - excludeStart.x)}
                height={Math.abs(excludeCurrent.y - excludeStart.y)}
                fill="rgba(239, 68, 68, 0.22)"
                stroke="#EF4444"
                strokeWidth={2.5}
                dash={[6, 4]}
              />
              <Rect
                x={Math.min(excludeStart.x, excludeCurrent.x)}
                y={Math.max(10, Math.min(excludeStart.y, excludeCurrent.y) - 24)}
                width={200}
                height={22}
                fill="#EF4444"
                cornerRadius={4}
              />
              <Text
                x={Math.min(excludeStart.x, excludeCurrent.x) + 6}
                y={Math.max(10, Math.min(excludeStart.y, excludeCurrent.y) - 18)}
                text={`Excluding: ${Math.round(Math.abs(excludeCurrent.x - excludeStart.x))} × ${Math.round(Math.abs(excludeCurrent.y - excludeStart.y))} px`}
                fontSize={11}
                fontFamily="JetBrains Mono, monospace"
                fill="#FFFFFF"
                fontStyle="bold"
              />
            </Group>
          )}
        </Layer>

        {/* Layer 2: Architectural Rooms Overlay */}
        <Layer listening={false}>
          {rooms.map((r, i) => (
            <Group key={`room_${i}`} x={r.x} y={r.y}>
              <Rect
                width={r.width}
                height={r.height}
                fill="rgba(59, 130, 246, 0.04)"
                stroke="rgba(59, 130, 246, 0.25)"
                strokeWidth={1.5}
                dash={[6, 4]}
              />
              <Text
                text={r.name.toUpperCase()}
                fontSize={14}
                fontFamily="JetBrains Mono, monospace"
                fontStyle="bold"
                fill="rgba(59, 130, 246, 0.7)"
                x={8}
                y={8}
              />
            </Group>
          ))}
        </Layer>

        {/* Layer 3: Interactive Takeoff Markers */}
        <Layer>
          {visibleMarkers.map((m) => {
            const legend = legendMap.get(m.legend_id);
            const color = legend ? legend.color : "#3B82F6";
            const isSelected = m.marker_id === effectiveSelectedId;
            const isHovered = m.marker_id === hoveredMarkerId;
            const isReview = m.status === "needs_review";
            const isVerified = m.status === "user_verified";
            const isAIVerified = m.status === "ai_verified";
            const isManual = m.status === "manual_added";

            // Compute rotation-invariant canonical radius so vertical/horizontal symbols have uniform circles
            const canonicalDim = Math.max(m.width || 30, m.height || 30);
            const radius = Math.max(16, Math.round(canonicalDim / 2) + 3);

            return (
              <Group
                key={m.marker_id}
                x={m.x + (m.width || 30) / 2}
                y={m.y + (m.height || 30) / 2}
                onClick={(e) => {
                  e.cancelBubble = true;
                  setSelectedMarkerId(m.marker_id);
                }}
                onMouseEnter={() => setHoveredMarkerId(m.marker_id)}
                onMouseLeave={() => setHoveredMarkerId(null)}
                cursor="pointer"
              >
                {/* Needs Review Pulse Halo */}
                {isReview && (
                  <Circle
                    radius={radius + 8}
                    fill="transparent"
                    stroke="#F59E0B"
                    strokeWidth={2.5}
                    dash={[4, 4]}
                    opacity={0.85}
                  />
                )}

                {/* AI Verified Purple Halo */}
                {isAIVerified && (
                  <Circle
                    radius={radius + 6}
                    fill="transparent"
                    stroke="#8B5CF6"
                    strokeWidth={2}
                    dash={[3, 3]}
                    opacity={0.9}
                  />
                )}

                {/* Selected Halo */}
                {isSelected && (
                  <Circle
                    radius={radius + 6}
                    fill="transparent"
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    shadowColor="#3B82F6"
                    shadowBlur={12}
                  />
                )}

                {/* Marker Main Ring - Translucent Fill + Crisp Colored Border so drawing is 100% visible */}
                <Circle
                  radius={radius}
                  fill={isAIVerified ? "#8B5CF6" : color}
                  opacity={0.18} // Translucent so CAD lines and symbol are clearly seen underneath
                  stroke={isAIVerified ? "#8B5CF6" : color}
                  strokeWidth={isSelected ? 3 : 2}
                  shadowColor={isAIVerified ? "#8B5CF6" : color}
                  shadowBlur={isSelected ? 10 : 4}
                />

                {/* Center Precision Bullseye Dot */}
                <Circle
                  radius={3}
                  fill={isAIVerified ? "#8B5CF6" : color}
                  stroke="#FFFFFF"
                  strokeWidth={1}
                />

                {/* Status Indicator Icon Badge */}
                {isVerified && (
                  <Group x={radius - 6} y={-radius + 4}>
                    <Circle radius={7} fill="#10B981" stroke="#FFFFFF" strokeWidth={1} />
                    <Text
                      text="✓"
                      fontSize={9}
                      fontStyle="bold"
                      fill="#FFFFFF"
                      align="center"
                      offsetX={3.5}
                      offsetY={5}
                    />
                  </Group>
                )}

                {isAIVerified && (
                  <Group x={radius - 6} y={-radius + 4}>
                    <Circle radius={8} fill="#8B5CF6" stroke="#FFFFFF" strokeWidth={1} />
                    <Text
                      text="AI"
                      fontSize={7}
                      fontFamily="JetBrains Mono"
                      fontStyle="bold"
                      fill="#FFFFFF"
                      align="center"
                      offsetX={4.5}
                      offsetY={4.5}
                    />
                  </Group>
                )}

                {isManual && (
                  <Group x={radius - 6} y={-radius + 4}>
                    <Circle radius={7} fill="#06B6D4" stroke="#FFFFFF" strokeWidth={1} />
                    <Text
                      text="M"
                      fontSize={8}
                      fontFamily="JetBrains Mono"
                      fontStyle="bold"
                      fill="#FFFFFF"
                      align="center"
                      offsetX={4}
                      offsetY={5}
                    />
                  </Group>
                )}

                {!isVerified && !isAIVerified && !isManual && (
                  <Group x={-radius + 4} y={-radius - 8}>
                    <Rect
                      fill="rgba(15, 23, 42, 0.85)"
                      stroke={isReview ? "#F59E0B" : "#334155"}
                      strokeWidth={1}
                      cornerRadius={3}
                      width={28}
                      height={13}
                    />
                    <Text
                      text={`${Math.round(m.confidence_score * 100)}%`}
                      fontSize={8}
                      fontFamily="JetBrains Mono"
                      fontStyle="bold"
                      fill={isReview ? "#F59E0B" : "#F8FAFC"}
                      x={2}
                      y={2}
                    />
                  </Group>
                )}

                {/* Hover Label */}
                {(isHovered || isSelected) && (
                  <Group y={-radius - 18}>
                    <Rect
                      fill="#0F172A"
                      stroke="#334155"
                      strokeWidth={1}
                      cornerRadius={4}
                      height={20}
                      width={legend?.label ? legend.label.length * 7 + 16 : 80}
                      offsetX={(legend?.label ? legend.label.length * 7 + 16 : 80) / 2}
                    />
                    <Text
                      text={legend?.label || "Symbol"}
                      fontSize={10}
                      fontStyle="bold"
                      fill="#F8FAFC"
                      align="center"
                      width={legend?.label ? legend.label.length * 7 + 16 : 80}
                      offsetX={(legend?.label ? legend.label.length * 7 + 16 : 80) / 2}
                      y={4}
                    />
                  </Group>
                )}
              </Group>
            );
          })}
        </Layer>

        {/* Layer 4: Tool Overlays (Crop Box & Measure Line) */}
        <Layer>
          {cropBox && (
            <Group>
              <Rect
                x={cropBox.x}
                y={cropBox.y}
                width={cropBox.width}
                height={cropBox.height}
                fill="rgba(59, 130, 246, 0.2)"
                stroke="#3B82F6"
                strokeWidth={2}
                dash={[6, 4]}
              />
              <Text
                text={`Crop: ${Math.round(cropBox.width)} × ${Math.round(cropBox.height)} px`}
                x={cropBox.x + 4}
                y={cropBox.y - 18}
                fontSize={11}
                fontFamily="JetBrains Mono"
                fill="#3B82F6"
                fontStyle="bold"
              />
            </Group>
          )}

          {measurePoints.length === 4 && (
            <Group>
              <Line
                points={measurePoints}
                stroke="#10B981"
                strokeWidth={3}
                dash={[8, 4]}
              />
              <Circle x={measurePoints[0]} y={measurePoints[1]} radius={5} fill="#10B981" />
              <Circle x={measurePoints[2]} y={measurePoints[3]} radius={5} fill="#10B981" />
            </Group>
          )}
        </Layer>
      </Stage>

      {/* Floating Marker Human-In-The-Loop Review Card */}
      {activeMarker && visibleMarkers.some((m) => m.marker_id === activeMarker.marker_id) && (
        <div
          className="marker-review-card"
          style={{
            bottom: 24,
            left: 24,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8" }}>
              SYMBOL VERIFICATION
            </span>
            <span
              style={{
                fontSize: 10,
                fontFamily: "JetBrains Mono",
                padding: "2px 6px",
                borderRadius: 4,
                backgroundColor:
                  activeMarker.status === "user_verified"
                    ? "rgba(16, 185, 129, 0.2)"
                    : activeMarker.status === "ai_verified"
                    ? "rgba(139, 92, 246, 0.25)"
                    : activeMarker.status === "needs_review"
                    ? "rgba(245, 158, 11, 0.2)"
                    : "rgba(59, 130, 246, 0.2)",
                color:
                  activeMarker.status === "user_verified"
                    ? "#10B981"
                    : activeMarker.status === "ai_verified"
                    ? "#A78BFA"
                    : activeMarker.status === "needs_review"
                    ? "#F59E0B"
                    : "#3B82F6",
              }}
            >
              {activeMarker.status === "ai_verified" ? "AI CONFIRMED (Needs Sign-off)" : activeMarker.status.replace("_", " ").toUpperCase()}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: legendMap.get(activeMarker.legend_id)?.color || "#3B82F6",
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#F8FAFC" }}>
              {legendMap.get(activeMarker.legend_id)?.label || "Electrical Symbol"}
            </span>
          </div>

          <div style={{ fontSize: 11, color: "#94A3B8", display: "flex", gap: 12 }}>
            <span>Room: <strong style={{ color: "#F8FAFC" }}>{activeMarker.room || "Unassigned"}</strong></span>
            <span>Confidence: <strong style={{ color: "#F8FAFC" }}>{Math.round(activeMarker.confidence_score * 100)}%</strong></span>
          </div>

          {/* Quick Action Buttons */}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button
              className="btn-success"
              style={{ flex: 1, padding: "6px 10px", fontSize: 11 }}
              onClick={() => onUpdateMarker(activeMarker.marker_id, { status: "user_verified" })}
            >
              <ShieldCheck size={14} />
              <span>Approve</span>
            </button>

            <button
              className="btn-secondary"
              style={{ padding: "6px 10px", fontSize: 11, color: "#EF4444" }}
              onClick={() => onDeleteMarker(activeMarker.marker_id)}
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating Canvas Symbol Isolation Switcher */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 20,
          zIndex: 30,
          background: "rgba(15, 23, 42, 0.9)",
          backdropFilter: "blur(10px)",
          border: "1px solid #334155",
          borderRadius: 20,
          padding: "3px 6px",
          display: "flex",
          gap: 4,
          alignItems: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}
      >
        <button
          onClick={() => setIsolateActiveSymbol(true)}
          style={{
            background: isolateActiveSymbol ? "rgba(59, 130, 246, 0.25)" : "transparent",
            color: isolateActiveSymbol ? "#60A5FA" : "#94A3B8",
            border: isolateActiveSymbol ? "1px solid #3B82F6" : "1px solid transparent",
            borderRadius: 14,
            padding: "3px 10px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
          title="Only display markers for the currently selected symbol"
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: selectedLegendId ? (legendMap.get(selectedLegendId)?.color || "#3B82F6") : "#3B82F6" }} />
          <span>Active Symbol Only ({markers.filter(m => m.legend_id === selectedLegendId).length})</span>
        </button>

        <button
          onClick={() => setIsolateActiveSymbol(false)}
          style={{
            background: !isolateActiveSymbol ? "rgba(59, 130, 246, 0.25)" : "transparent",
            color: !isolateActiveSymbol ? "#60A5FA" : "#94A3B8",
            border: !isolateActiveSymbol ? "1px solid #3B82F6" : "1px solid transparent",
            borderRadius: 14,
            padding: "3px 10px",
            fontSize: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
          title="Display markers across all symbols"
        >
          <span>All Symbols ({markers.length})</span>
        </button>
      </div>
    </div>
  );
};
