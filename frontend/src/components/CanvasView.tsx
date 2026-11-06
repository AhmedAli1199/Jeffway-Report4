import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Group, Image as KImage, Layer, Rect, Stage, Text, Circle } from "react-konva";
import type Konva from "konva";
import { LoaderCircle } from "lucide-react";
import { api } from "../lib/api";
import type { Takeoff } from "../state/useTakeoff";
import type { CanvasMode, Marker } from "../lib/types";
import { cx, isApproved, normRect } from "../lib/util";

export interface CanvasControls {
  fit: () => void;
  zoomBy: (f: number) => void;
  zoomTo: (s: number) => void;
  scale: number;
}

interface Props {
  t: Takeoff;
  mode: CanvasMode;
  themeKey: string;
  controlsRef: Ref<CanvasControls>;
  onScale: (s: number) => void;
}

const MIN = 0.08;
const MAX = 8;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Re-tint a white CAD sheet as a blueprint, keeping coloured symbols readable. */
function toBlueprint(img: HTMLImageElement): HTMLCanvasElement | null {
  try {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    const bg = [13, 39, 66];
    const ink = [214, 230, 250];
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min > 70) {
        // Coloured stroke: lift it so it reads on dark blue
        p[i] = Math.min(255, r + 50);
        p[i + 1] = Math.min(255, g + 50);
        p[i + 2] = Math.min(255, b + 50);
        continue;
      }
      const t = 1 - (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      p[i] = bg[0] + (ink[0] - bg[0]) * t;
      p[i + 1] = bg[1] + (ink[1] - bg[1]) * t;
      p[i + 2] = bg[2] + (ink[2] - bg[2]) * t;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  } catch {
    return null;
  }
}

export function CanvasView({ t, mode, themeKey, controlsRef, onScale }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState({ scale: 0.3, x: 40, y: 40 });
  const [draft, setDraft] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { project, pageIndex, tool } = t;

  // Resize
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load page image
  useEffect(() => {
    if (!project) return;
    setLoading(true);
    setFailed(false);
    const im = new window.Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      setImg(im);
      setLoading(false);
    };
    im.onerror = () => {
      setLoading(false);
      setFailed(true);
    };
    im.src = api.pageImageUrl(project.filepath, pageIndex);
    return () => {
      im.onload = null;
      im.onerror = null;
    };
  }, [project, pageIndex]);

  const blueprint = useMemo(() => (img && mode === "blueprint" ? toBlueprint(img) : null), [img, mode]);

  const fit = () => {
    if (!img) return;
    const s = Math.min(size.w / img.naturalWidth, size.h / img.naturalHeight) * 0.92;
    setView({ scale: s, x: (size.w - img.naturalWidth * s) / 2, y: (size.h - img.naturalHeight * s) / 2 });
  };

  // Fit whenever a new sheet loads
  const fittedFor = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (img && fittedFor.current !== img && size.w > 50) {
      fittedFor.current = img;
      fit();
    }
  }, [img, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAround = (factor: number, px = size.w / 2, py = size.h / 2) => {
    setView((v) => {
      const s = Math.max(MIN, Math.min(MAX, v.scale * factor));
      const k = s / v.scale;
      return { scale: s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  useEffect(() => onScale(view.scale), [view.scale, onScale]);

  useImperativeHandle(
    controlsRef,
    () => ({
      fit,
      zoomBy: (f: number) => zoomAround(f),
      zoomTo: (s: number) => zoomAround(s / view.scale),
      scale: view.scale,
    }),
  );

  // Bring the selected marker into view
  const sel = t.selectedMarker;
  useEffect(() => {
    if (!sel || sel.page_index !== pageIndex) return;
    setView((v) => {
      const s = Math.max(v.scale, 0.75);
      const cx0 = sel.x + sel.width / 2;
      const cy0 = sel.y + sel.height / 2;
      const sx = cx0 * s + v.x;
      const sy = cy0 * s + v.y;
      const margin = 120;
      const inView = s === v.scale && sx > margin && sx < size.w - margin && sy > margin && sy < size.h - margin - 80;
      if (inView) return v;
      return { scale: s, x: size.w / 2 - cx0 * s, y: (size.h - 60) / 2 - cy0 * s };
    });
  }, [sel?.marker_id, pageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const colors = useMemo(
    () => ({
      copper: cssVar("--copper") || "#b4561f",
      ok: cssVar("--ok") || "#1f8a5b",
      review: cssVar("--review") || "#a87a06",
      ai: cssVar("--ai") || "#3e63dd",
      reject: cssVar("--reject") || "#c2362f",
      fg: cssVar("--fg") || "#14171c",
    }),
    [themeKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pointer = () => stageRef.current?.getRelativePointerPosition() ?? null;

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    // Trackpad pinch arrives with ctrlKey and small deltas; mouse wheels arrive in large steps
    const intensity = e.evt.ctrlKey ? 0.012 : 0.0018;
    const factor = Math.exp(-e.evt.deltaY * intensity);
    zoomAround(Math.max(0.5, Math.min(2, factor)), p.x, p.y);
  };

  const isDrawTool = tool === "crop" || tool === "exclude" || tool === "room";

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    const p = pointer();
    if (!p) return;
    if (isDrawTool) {
      setDraft({ a: p, b: p });
    } else if (tool === "add") {
      t.addManual(p.x, p.y);
    }
  };

  const onMove = () => {
    if (!draft) return;
    const p = pointer();
    if (p) setDraft({ ...draft, b: p });
  };

  const onUp = () => {
    if (!draft) return;
    const r = normRect(draft.a, draft.b);
    setDraft(null);
    if (r.width < 6 || r.height < 6) return;
    if (tool === "crop") {
      let b64: string | undefined;
      if (img) {
        try {
          const c = document.createElement("canvas");
          c.width = Math.round(r.width);
          c.height = Math.round(r.height);
          c.getContext("2d")?.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, c.width, c.height);
          b64 = c.toDataURL("image/png");
        } catch {
          b64 = undefined;
        }
      }
      t.finishCrop(
        { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        b64,
      );
    } else if (tool === "exclude") {
      t.addExcluded(r);
    } else if (tool === "room") {
      t.setPendingRoom(r);
      t.setTool("select");
    }
  };

  const legendById = useMemo(() => new Map(t.legends.map((l) => [l.legend_id, l])), [t.legends]);
  const inv = 1 / view.scale;

  const statusColor = (m: Marker) =>
    isApproved(m) ? colors.ok : m.status === "ai_verified" ? colors.ai : m.status === "needs_review" || m.status === "possible_missed" ? colors.review : null;

  const draftRect = draft ? normRect(draft.a, draft.b) : null;
  const draftColor = tool === "crop" ? colors.copper : tool === "exclude" ? colors.reject : colors.fg;

  return (
    <div
      ref={wrapRef}
      className={cx("canvas-root", `tool-${tool}`, dragging && "dragging")}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={tool === "select"}
        onDragStart={() => setDragging(true)}
        onDragMove={(e) => {
          if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onDragEnd={(e) => {
          setDragging(false);
          if (e.target === stageRef.current) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
        }}
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onClick={(e) => {
          if (tool === "select" && (e.target === e.target.getStage() || e.target.name() === "sheet")) t.selectMarker(null);
        }}
      >
        <Layer listening={!loading}>
          {img && (
            <KImage
              name="sheet"
              image={blueprint ?? img}
              width={img.naturalWidth}
              height={img.naturalHeight}
              shadowColor="black"
              shadowOpacity={0.12}
              shadowBlur={24 * inv}
              shadowOffsetY={4 * inv}
            />
          )}

          {t.zones.map((z, i) => (
            <Group key={`z${i}`} listening={false}>
              <Rect x={z.x} y={z.y} width={z.width} height={z.height} fill={colors.reject} opacity={0.07} />
              <Rect
                x={z.x} y={z.y} width={z.width} height={z.height}
                stroke={colors.reject} strokeWidth={1.5} strokeScaleEnabled={false} dash={[8, 6]} opacity={0.7}
              />
              <Text x={z.x} y={z.y - 18 * inv} text={`${z.label ?? "Excluded"} · not counted`} fontSize={12 * inv} fill={colors.reject} fontStyle="500" />
            </Group>
          ))}

          {t.pageRooms.map((r, i) => (
            <Group key={`r${i}`} listening={false}>
              <Rect
                x={r.x} y={r.y} width={r.width} height={r.height}
                stroke={colors.fg} strokeWidth={1} strokeScaleEnabled={false} dash={[4, 4]} opacity={0.35}
              />
              <Text x={r.x + 6 * inv} y={r.y + 6 * inv} text={r.name.toUpperCase()} fontSize={11 * inv} fill={colors.fg} opacity={0.55} letterSpacing={0.8 * inv} />
            </Group>
          ))}

          {t.visibleMarkers.map((m) => {
            const l = legendById.get(m.legend_id);
            const col = l?.color ?? colors.copper;
            const dim = t.selectedLegendId && m.legend_id !== t.selectedLegendId;
            const st = statusColor(m);
            const pad = 3;
            const selected = m.marker_id === t.selectedMarkerId;
            return (
              <Group
                key={m.marker_id}
                opacity={dim ? 0.28 : 1}
                listening={tool === "select"}
                onClick={(e) => {
                  e.cancelBubble = true;
                  t.selectMarker(m.marker_id);
                }}
                onMouseEnter={() => setHoverId(m.marker_id)}
                onMouseLeave={() => setHoverId((h) => (h === m.marker_id ? null : h))}
              >
                <Rect
                  x={m.x - pad} y={m.y - pad} width={m.width + pad * 2} height={m.height + pad * 2}
                  cornerRadius={4}
                  fill={col}
                  opacity={isApproved(m) ? 0.16 : hoverId === m.marker_id ? 0.12 : 0.05}
                />
                <Rect
                  x={m.x - pad} y={m.y - pad} width={m.width + pad * 2} height={m.height + pad * 2}
                  cornerRadius={4}
                  stroke={col}
                  strokeWidth={hoverId === m.marker_id ? 2.5 : 1.75}
                  strokeScaleEnabled={false}
                  dash={m.status === "needs_review" || m.status === "possible_missed" ? [5, 3] : undefined}
                />
                {st && (
                  <Circle
                    x={m.x + m.width + pad}
                    y={m.y - pad}
                    radius={Math.max(3.5 * inv, 3)}
                    fill={st}
                    stroke="white"
                    strokeWidth={1}
                    strokeScaleEnabled={false}
                  />
                )}
                {selected && (
                  <Rect
                    x={m.x - pad - 5 * inv} y={m.y - pad - 5 * inv}
                    width={m.width + pad * 2 + 10 * inv} height={m.height + pad * 2 + 10 * inv}
                    cornerRadius={7 * inv}
                    stroke={colors.copper}
                    strokeWidth={2.5}
                    strokeScaleEnabled={false}
                    shadowColor={colors.copper}
                    shadowBlur={10}
                    shadowOpacity={0.5}
                  />
                )}
              </Group>
            );
          })}

          {draftRect && (
            <Group listening={false}>
              <Rect {...draftRect} fill={draftColor} opacity={0.08} />
              <Rect {...draftRect} stroke={draftColor} strokeWidth={1.5} strokeScaleEnabled={false} dash={[6, 4]} />
              <Text
                x={draftRect.x}
                y={draftRect.y - 18 * inv}
                text={`${Math.round(draftRect.width)} × ${Math.round(draftRect.height)} px`}
                fontSize={11 * inv}
                fill={draftColor}
              />
            </Group>
          )}
        </Layer>
      </Stage>

      {loading && (
        <div className="canvas-loading">
          <div className="card">
            <LoaderCircle size={16} className="spin" /> Rendering sheet…
          </div>
        </div>
      )}
      {failed && !loading && (
        <div className="canvas-loading">
          <div className="card">Couldn't render this sheet. Check the backend is running.</div>
        </div>
      )}
    </div>
  );
}
