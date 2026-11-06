import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, Crop, FileUp, ImageUp, Layers, LoaderCircle, Minus, Plus, Scan, Search, Trash, TriangleAlert,
} from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import type { LibrarySymbol, ProjectSummary } from "../lib/types";
import { CATEGORIES, FIX_STAGES, SYMBOL_COLORS } from "../lib/util";
import { Modal, SymbolSample } from "./ui";

type WorkbookRow = { row: number; description: string; manufacturer: string; part_code: string; unit_price: number | null };

const idOf = (s: LibrarySymbol) => (s.legend_id || s.symbol_id || "") as string;

/* ================================================================== library */

export function SymbolLibrary({
  onClose, inProject, onAddToProject, onChanged,
}: {
  onClose: () => void;
  inProject?: Set<string>;
  onAddToProject?: (s: LibrarySymbol) => void;
  onChanged?: (lib: LibrarySymbol[]) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<LibrarySymbol[] | null>(null);
  const [q, setQ] = useState("");
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    api.library().then(setRows).catch((e) => toast({ tone: "error", title: "Couldn't load the library", body: (e as Error).message }));
  }, [toast]);

  const list = (rows ?? [])
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => `${r.cad_label} ${r.sheet_desc} ${r.category}`.toLowerCase().includes(q.toLowerCase()));

  const edit = (i: number, patch: Partial<LibrarySymbol>) => {
    setRows((prev) => prev?.map((r, j) => (j === i ? { ...r, ...patch } : r)) ?? null);
    setDirty(true);
  };

  const save = async () => {
    if (!rows) return;
    try {
      await api.saveLibrary(rows);
      setDirty(false);
      onChanged?.(rows);
      toast({ tone: "success", title: "Symbol library saved" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
    }
  };

  const remove = async (s: LibrarySymbol) => {
    try {
      await api.deleteSymbol(idOf(s));
      const next = (rows ?? []).filter((r) => idOf(r) !== idOf(s));
      setRows(next);
      onChanged?.(next);
      toast({ tone: "info", title: `Removed ${s.cad_label}` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't remove", body: (e as Error).message });
    } finally {
      setConfirmDel(null);
    }
  };

  if (adding) {
    return (
      <NewSymbol
        onCancel={() => setAdding(false)}
        onAdded={(s) => {
          const next = [...(rows ?? []), s];
          setRows(next);
          onChanged?.(next);
          setAdding(false);
          toast({ tone: "success", title: `${s.cad_label} added`, body: "Every takeoff run from now on looks for it." });
        }}
      />
    );
  }

  return (
    <Modal
      wide
      className="library-modal"
      title="Symbol library"
      subtitle="Every symbol Plotline looks for in a takeoff run. Each one links a drawing symbol to a line in Jeffway's tender workbook, its price and its cable allowance."
      onClose={onClose}
      footer={
        <>
          <span className="muted grow">{rows?.length ?? "–"} symbols</span>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!dirty} onClick={save}>Save changes</button>
        </>
      }
    >
      <div className="row">
        <div className="search grow">
          <Search size={14} />
          <input className="input" placeholder="Search symbols" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn btn-copper" onClick={() => setAdding(true)}>
          <Plus size={14} /> New symbol
        </button>
      </div>
      {!rows ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div style={{ overflowX: "auto", margin: "0 -20px" }}>
          <table className="boq" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Workbook line</th>
                <th>£ / unit</th>
                <th>Cable m / point</th>
                <th>Cable type</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map(({ r, i }) => {
                const id = idOf(r);
                return (
                  <tr key={id || i}>
                    <td>
                      <span className="label" style={{ maxWidth: 260 }}>
                        <SymbolSample
                          size={30}
                          legend={{ legend_id: id, label: r.cad_label ?? "", color: (r.color as string) ?? "var(--line-strong)", category: "", fix_stage: "2nd Fix", manufacturer: "", part_code: "", template_image_b64: r.template_image_b64 }}
                        />
                        <span title={r.cad_label}>{r.cad_label}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: "left" }}>
                      {r.sheet_row ? (
                        <span className="truncate" style={{ display: "inline-block", maxWidth: 220 }} title={r.sheet_desc}>
                          <span className="mono muted">r{r.sheet_row} </span>{r.sheet_desc}
                        </span>
                      ) : (
                        <span className="pill pill-review">Not linked</span>
                      )}
                    </td>
                    <td>
                      <input className="input mono" style={{ width: 80, height: 26, textAlign: "right" }} type="number" step="0.01"
                        value={r.unit_price ?? ""} onChange={(e) => edit(i, { unit_price: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    </td>
                    <td>
                      <input className="input mono" style={{ width: 70, height: 26, textAlign: "right" }} type="number" step="0.5"
                        value={r.cable_per_point_m ?? ""} onChange={(e) => edit(i, { cable_per_point_m: e.target.value === "" ? undefined : Number(e.target.value) })} />
                    </td>
                    <td>
                      <input className="input" style={{ width: 140, height: 26 }} value={r.cable_type ?? ""} onChange={(e) => edit(i, { cable_type: e.target.value })} />
                    </td>
                    <td>
                      <span className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                        {onAddToProject &&
                          (inProject?.has(id) ? (
                            <span className="pill pill-plain">In drawing</span>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => onAddToProject(r)}><Plus size={13} /> Use</button>
                          ))}
                        {confirmDel === id ? (
                          <>
                            <button className="btn btn-danger btn-sm" onClick={() => remove(r)}>Remove</button>
                            <button className="btn btn-quiet btn-sm" onClick={() => setConfirmDel(null)}>Keep</button>
                          </>
                        ) : (
                          <button className="icon-btn icon-btn-sm" aria-label={`Remove ${r.cad_label}`} title="Remove from library" onClick={() => setConfirmDel(id)}>
                            <Trash size={13} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ================================================================== new symbol */

type Source = "upload" | "drawing" | "pdf";

export function NewSymbol({
  onCancel, onAdded, initialImage, initialLabel,
}: {
  onCancel: () => void;
  onAdded: (s: LibrarySymbol) => void;
  initialImage?: string;
  initialLabel?: string;
}) {
  const toast = useToast();
  const [source, setSource] = useState<Source>(initialImage ? "drawing" : "upload");
  const [image, setImage] = useState<string | null>(initialImage ?? null);
  const [sizePx, setSizePx] = useState(40);
  const [rowsWb, setRowsWb] = useState<WorkbookRow[]>([]);
  const [form, setForm] = useState({
    cad_label: initialLabel ?? "",
    sheet_row: "" as string,
    category: "Power & Accessories",
    fix_stage: "2nd Fix",
    unit_price: "",
    cable_per_point_m: "",
    cable_type: "",
    color: SYMBOL_COLORS[0],
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    api.workbookRows().then(setRowsWb).catch(() => {});
  }, []);

  const wbRow = rowsWb.find((r) => String(r.row) === form.sheet_row);

  const save = async () => {
    if (!image) return;
    setSaving(true);
    try {
      const s = await api.addSymbol({
        cad_label: form.cad_label.trim(),
        template_image_b64: image,
        source,
        resize_to_px: source === "upload" ? sizePx : undefined,
        sheet_row: form.sheet_row ? Number(form.sheet_row) : undefined,
        sheet_desc: wbRow?.description,
        manufacturer: wbRow?.manufacturer ?? "",
        part_code: wbRow?.part_code ?? "",
        unit_price: form.unit_price === "" ? (wbRow?.unit_price ?? undefined) : Number(form.unit_price),
        category: form.category,
        fix_stage: form.fix_stage,
        cable_per_point_m: form.cable_per_point_m === "" ? undefined : Number(form.cable_per_point_m),
        cable_type: form.cable_type || undefined,
        color: form.color,
      });
      onAdded(s);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't add the symbol", body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      wide
      className="newsym-modal"
      title="New symbol"
      subtitle="Give Plotline one clean example of the symbol and say which workbook line it counts towards."
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}><ArrowLeft size={14} /> Back to library</button>
          <span className="grow" />
          <button className="btn btn-copper" disabled={!image || !form.cad_label.trim() || saving} onClick={save}>
            {saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Add to library
          </button>
        </>
      }
    >
      <div className="newsym-grid">
        <section className="stack" style={{ gap: 12, minWidth: 0 }}>
          <span className="eyebrow">1 · The symbol's picture</span>
          <div className="seg" role="group" style={{ justifySelf: "start", flexWrap: "wrap" }}>
            <button aria-pressed={source === "upload"} onClick={() => { setSource("upload"); setImage(null); }}><ImageUp size={13} /> Upload a picture</button>
            <button aria-pressed={source === "drawing"} onClick={() => { setSource("drawing"); setImage(null); }}><Layers size={13} /> Crop from a drawing in Plotline</button>
            <button aria-pressed={source === "pdf"} onClick={() => { setSource("pdf"); setImage(null); }}><FileUp size={13} /> Crop from another PDF</button>
          </div>
          {source === "upload" && <UploadSource image={image} setImage={setImage} sizePx={sizePx} setSizePx={setSizePx} />}
          {source === "drawing" && <DrawingSource image={image} setImage={setImage} />}
          {source === "pdf" && <PdfSource image={image} setImage={setImage} />}
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <span className="eyebrow">2 · What it is</span>
          <div className="sample-preview">
            {image ? <img src={image} alt="Sample" /> : <span className="muted">No picture yet</span>}
          </div>
          <div className="field">
            <label htmlFor="ns-label">Name, as written on the legend</label>
            <input id="ns-label" className="input" value={form.cad_label} placeholder="e.g. 13A switched double socket at low level" onChange={(e) => set({ cad_label: e.target.value })} />
            <span className="hint">Plotline also uses this text to recognise the legend on each sheet.</span>
          </div>
          <div className="field">
            <label htmlFor="ns-row">Workbook line it counts towards</label>
            <select id="ns-row" className="select" value={form.sheet_row} onChange={(e) => {
              const r = rowsWb.find((x) => String(x.row) === e.target.value);
              set({ sheet_row: e.target.value, unit_price: r?.unit_price != null ? String(r.unit_price) : form.unit_price });
            }}>
              <option value="">Not linked yet (won't go into the workbook)</option>
              {rowsWb.map((r) => (
                <option key={r.row} value={r.row}>r{r.row} · {r.description}{r.part_code ? ` · ${r.part_code}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="ns-cat">Category</label>
              <select id="ns-cat" className="select" value={form.category} onChange={(e) => set({ category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ns-stage">Fix stage</label>
              <select id="ns-stage" className="select" value={form.fix_stage} onChange={(e) => set({ fix_stage: e.target.value })}>
                {FIX_STAGES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ns-price">£ per unit</label>
              <input id="ns-price" className="input mono" type="number" step="0.01" value={form.unit_price} onChange={(e) => set({ unit_price: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ns-cable">Cable m per point</label>
              <input id="ns-cable" className="input mono" type="number" step="0.5" value={form.cable_per_point_m} onChange={(e) => set({ cable_per_point_m: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ns-ctype">Cable type</label>
            <input id="ns-ctype" className="input" placeholder="e.g. 1.0mm T&E" value={form.cable_type} onChange={(e) => set({ cable_type: e.target.value })} />
          </div>
          <div className="field">
            <label>Mark colour</label>
            <div className="color-row">
              {SYMBOL_COLORS.map((c) => (
                <button type="button" key={c} style={{ background: c }} aria-label={c} aria-pressed={form.color === c} onClick={() => set({ color: c })} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ sources */

function UploadSource({ image, setImage, sizePx, setSizePx }: {
  image: string | null; setImage: (s: string | null) => void; sizePx: number; setSizePx: (n: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div
        className="dropzone small"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) readFile(f, setImage);
        }}
      >
        <ImageUp size={22} />
        <b>{image ? "Picture loaded" : "Drop a PNG or JPG here"}</b>
        <button className="btn btn-ghost btn-sm" onClick={() => ref.current?.click()}>Choose picture</button>
        <input ref={ref} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) readFile(f, setImage);
        }} />
      </div>
      <div className="field">
        <label htmlFor="ns-size">Size on a 1:50 drawing: {sizePx} px</label>
        <input id="ns-size" type="range" className="slider" min={18} max={90} step={2} value={sizePx} onChange={(e) => setSizePx(Number(e.target.value))} />
        <span className="hint">
          Plotline matches symbols at their printed size on the sheet. A picture from a manual or screenshot is scaled so its longest
          side is this many pixels at 200 dpi (most sockets and lights are 30–50). Cropping from a drawing avoids guessing.
        </span>
      </div>
      {image && (
        <div className="row">
          <span className="muted">Actual size it will be matched at:</span>
          <span className="actual-size" style={{ width: sizePx, height: sizePx }}><img src={image} alt="" /></span>
        </div>
      )}
    </div>
  );
}

function readFile(f: File, done: (s: string) => void) {
  const r = new FileReader();
  r.onload = () => done(String(r.result));
  r.readAsDataURL(f);
}

function DrawingSource({ image, setImage }: { image: string | null; setImage: (s: string | null) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [proj, setProj] = useState<ProjectSummary | null>(null);
  const [pages, setPages] = useState<{ page_index: number; page_number: number; title: string; is_electrical: boolean }[] | null>(null);
  const [page, setPage] = useState<number | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!proj) return;
    setPages(null);
    setPage(null);
    api.projectDetails(proj.project_id, proj.filepath).then((d) => {
      const ps = [...d.pages].sort((a, b) => Number(b.is_electrical) - Number(a.is_electrical) || a.page_index - b.page_index);
      setPages(ps);
      const first = ps.find((p) => p.is_electrical);
      if (first) setPage(first.page_index);
    });
  }, [proj]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid2">
        <div className="field">
          <label htmlFor="ns-proj">Drawing</label>
          <select id="ns-proj" className="select" value={proj?.project_id ?? ""} onChange={(e) => setProj(projects?.find((p) => p.project_id === e.target.value) ?? null)}>
            <option value="">{projects ? "Choose a house type…" : "Loading…"}</option>
            {projects?.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ns-page">Sheet</label>
          <select id="ns-page" className="select" disabled={!pages} value={page ?? ""} onChange={(e) => setPage(Number(e.target.value))}>
            <option value="">{proj ? (pages ? "Choose a sheet…" : "Reading sheets…") : "Pick a drawing first"}</option>
            {pages?.map((p) => (
              <option key={p.page_index} value={p.page_index}>p.{p.page_number} · {p.title}{p.is_electrical ? " · electrical" : ""}</option>
            ))}
          </select>
        </div>
      </div>
      {proj && page != null ? (
        <Cropper filepath={proj.filepath} page={page} onCrop={setImage} hasCrop={!!image} />
      ) : (
        <p className="muted" style={{ margin: 0 }}>Pick a house type and a sheet, then drag a box around one example. The legend is a good place to crop from.</p>
      )}
    </div>
  );
}

function PdfSource({ image, setImage }: { image: string | null; setImage: (s: string | null) => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<{ filepath: string; name: string; pages: { page_index: number; page_number: number }[] } | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (f: File) => {
    setBusy(true);
    try {
      const r = await api.uploadSourcePdf(f);
      setPdf(r);
      setPage(r.pages.length === 1 ? 0 : null);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't open that PDF", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {!pdf ? (
        <div className="dropzone small" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) open(f); }}>
          {busy ? <LoaderCircle size={22} className="spin" /> : <FileUp size={22} />}
          <b>{busy ? "Opening…" : "Drop any PDF here"}</b>
          <span className="muted">A legend sheet, a manufacturer's datasheet, another developer's drawing</span>
          <button className="btn btn-ghost btn-sm" onClick={() => ref.current?.click()}>Choose PDF</button>
          <input ref={ref} type="file" hidden accept="application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) open(f); }} />
        </div>
      ) : page == null ? (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b className="truncate">{pdf.name} · pick a page</b>
            <button className="btn btn-quiet btn-sm" onClick={() => setPdf(null)}>Different PDF</button>
          </div>
          <div className="page-pick">
            {pdf.pages.map((p) => (
              <button key={p.page_index} className="page-pick-item" onClick={() => setPage(p.page_index)}>
                <img loading="lazy" src={api.pagePreviewUrl(pdf.filepath, p.page_index, 320)} alt="" />
                <span className="mono">p.{p.page_number}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b className="truncate">{pdf.name} · p.{page + 1}</b>
            <button className="btn btn-quiet btn-sm" onClick={() => setPage(null)}>Other page</button>
          </div>
          <Cropper filepath={pdf.filepath} page={page} onCrop={setImage} hasCrop={!!image} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ cropper */

/** Shows a sheet at 200 dpi (the resolution sheets are matched at) and crops a box from it. */
function Cropper({ filepath, page, onCrop, hasCrop }: { filepath: string; page: number; onCrop: (b64: string) => void; hasCrop: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(0.35);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const url = useMemo(() => api.pageImageUrl(filepath, page, 200), [filepath, page]);

  useEffect(() => {
    setNat(null);
    setRect(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      imgRef.current = im;
      setNat({ w: im.naturalWidth, h: im.naturalHeight });
      const cw = box.current?.clientWidth ?? 600;
      setScale(Math.max(0.15, Math.min(1, cw / im.naturalWidth)));
    };
    im.src = url;
  }, [url]);

  const toImg = (e: React.MouseEvent) => {
    const el = box.current!;
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left + el.scrollLeft) / scale, y: (e.clientY - r.top + el.scrollTop) / scale };
  };

  const finish = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    const x = Math.round(Math.min(d.x0, d.x1)), y = Math.round(Math.min(d.y0, d.y1));
    const w = Math.round(Math.abs(d.x1 - d.x0)), h = Math.round(Math.abs(d.y1 - d.y0));
    if (w < 6 || h < 6 || !imgRef.current) return;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(imgRef.current, x, y, w, h, 0, 0, w, h);
    setRect({ x, y, w, h });
    onCrop(c.toDataURL("image/png"));
  };

  const zoom = (k: number) => setScale((s) => Math.max(0.15, Math.min(2, s * k)));
  const r = drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : rect;

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {hasCrop ? <><Check size={12} style={{ color: "var(--ok)" }} /> Cropped. Drag again to redo.</> : <><Crop size={12} /> Zoom in, then drag a tight box around one example</>}
        </span>
        <span className="row" style={{ gap: 2 }}>
          <button className="icon-btn icon-btn-sm" aria-label="Zoom out" onClick={() => zoom(1 / 1.5)}><Minus size={13} /></button>
          <span className="mono muted" style={{ fontSize: 11, minWidth: 40, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
          <button className="icon-btn icon-btn-sm" aria-label="Zoom in" onClick={() => zoom(1.5)}><Plus size={13} /></button>
          <button className="icon-btn icon-btn-sm" aria-label="Fit" title="Fit" onClick={() => nat && setScale(Math.max(0.15, (box.current?.clientWidth ?? 600) / nat.w))}><Scan size={13} /></button>
        </span>
      </div>
      <div
        ref={box}
        className="cropper"
        onMouseDown={(e) => {
          if (!nat) return;
          const p = toImg(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onMouseMove={(e) => drag && setDrag({ ...drag, ...(() => { const p = toImg(e); return { x1: p.x, y1: p.y }; })() })}
        onMouseUp={() => {
          if (drag) finish(drag);
          setDrag(null);
        }}
        onMouseLeave={() => setDrag(null)}
      >
        {!nat ? (
          <div className="viewer-loading"><LoaderCircle size={18} className="spin" /> Rendering sheet…</div>
        ) : (
          <div style={{ position: "relative", width: nat.w * scale, height: nat.h * scale }}>
            <img src={url} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block", userSelect: "none" }} />
            {r && (
              <span className="crop-rect" style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }} />
            )}
          </div>
        )}
      </div>
      {nat && scale < 0.6 && !hasCrop && (
        <span className="hint muted" style={{ fontSize: 11.5 }}>
          <TriangleAlert size={11} /> Zoom in to at least 60% for an accurate crop.
        </span>
      )}
    </div>
  );
}

