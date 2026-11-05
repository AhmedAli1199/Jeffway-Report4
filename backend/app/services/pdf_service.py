import fitz  # PyMuPDF
import os
import re
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from PIL import Image
import io
from app.core.config import CACHE_DIR, Settings, settings

def hex_to_rgb(hex_color: str) -> Tuple[float, float, float]:
    """Convert hex #RRGGBB to float tuple (0-1, 0-1, 0-1) for PyMuPDF."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        return (r, g, b)
    return (0.2, 0.6, 1.0)

class PDFService:
    @staticmethod
    def inspect_pdf(file_path: str | Path) -> Dict[str, Any]:
        """Analyze PDF pages, detect titles, numbers, and classify page types."""
        file_path = Path(file_path)
        doc = fitz.open(str(file_path))
        pages_meta = []
        
        for idx in range(len(doc)):
            page = doc[idx]
            rect = page.rect
            text = page.get_text()
            
            # Detect drawing titles and drawing numbers from common title blocks
            drawing_no = ""
            title = f"Page {idx + 1}"
            page_type = "architectural"
            
            # Pattern matching for drawing numbers like KEYN/AVE(D)/900
            no_match = re.search(r'(KEYN/[A-Z0-9\(\)/\-]+|DRAWING NO\.?\s*:?\s*([A-Z0-9\/\-]+))', text, re.IGNORECASE)
            if no_match:
                drawing_no = no_match.group(1).strip()
            
            # Check if index/cover sheet
            lower_text = text.lower()
            if idx == 0 and ("drawing no" in lower_text or "amended drawings" in lower_text):
                page_type = "cover"
                title = "Cover Sheet & Drawing Register"
            elif "ground floor electrical plan" in lower_text or ("ground floor" in lower_text and "electrical legend" in lower_text):
                page_type = "electrical"
                title = "Ground Floor Electrical Plan"
            elif "first floor electrical plan" in lower_text or ("first floor" in lower_text and "electrical legend" in lower_text):
                page_type = "electrical"
                title = "First Floor Electrical Plan"
            elif "roof m&e plan" in lower_text or ("roof" in lower_text and "solar pv notes" in lower_text):
                page_type = "electrical"
                title = "Roof M&E & Solar PV Plan"
            elif "kitchen layout" in lower_text and "electrical legend" in lower_text:
                page_type = "electrical"
                title = "Kitchen Electrical Layout"
            elif "foundation" in lower_text:
                page_type = "structural"
                title = "Foundation Layout"
            elif "joist plan" in lower_text:
                page_type = "structural"
                title = "Joist Plan"
            elif "roof plan" in lower_text:
                page_type = "architectural"
                title = "Roof Plan"
            elif "elevation" in lower_text:
                page_type = "elevation"
                title = "Elevations"
            elif "section" in lower_text:
                page_type = "section"
                title = "Section Details"
            elif "schedule" in lower_text:
                page_type = "schedule"
                title = "Window/Door Schedules"
            elif "ground floor plan" in lower_text:
                page_type = "architectural"
                title = "Ground Floor Architectural Plan"
            elif "first floor plan" in lower_text:
                page_type = "architectural"
                title = "First Floor Architectural Plan"
            elif "sales" in lower_text:
                page_type = "sales"
                title = "Sales Plan"
            elif "risk" in lower_text:
                page_type = "document"
                title = "Risk Assessment"
            elif "electrical legend" in lower_text or "electrical layout" in lower_text:
                page_type = "electrical"
                title = "Electrical Layout"
            
            # If drawing_no found and not in title, append it
            display_label = f"P{idx + 1}: {title}"
            if drawing_no:
                display_label += f" ({drawing_no})"

            pages_meta.append({
                "page_index": idx,
                "page_number": idx + 1,
                "title": title,
                "drawing_no": drawing_no,
                "display_label": display_label,
                "page_type": page_type,
                "is_electrical": page_type == "electrical",
                "pdf_width_pts": rect.width,
                "pdf_height_pts": rect.height,
            })
            
        doc.close()
        return {
            "filename": file_path.name,
            "total_pages": len(pages_meta),
            "pages": pages_meta
        }

    @staticmethod
    def render_page_image(file_path: str | Path, page_index: int, dpi: int = 200) -> Tuple[Path, int, int]:
        """Render a specific PDF page to a crisp PNG image and return (path, width, height)."""
        file_path = Path(file_path)
        cache_key = f"{file_path.stem}_p{page_index}_{dpi}dpi.png"
        out_path = CACHE_DIR / cache_key
        
        if out_path.exists():
            with Image.open(out_path) as im:
                return out_path, im.width, im.height

        doc = fitz.open(str(file_path))
        page = doc[page_index]
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(str(out_path))
        doc.close()
        return out_path, pix.width, pix.height

    @staticmethod
    def detect_legend_zone(
        file_path: str | Path,
        page_index: int,
        dpi: int = 200,
        template_crop_coords: Optional[Dict[str, float]] = None
    ) -> Optional[Dict[str, float]]:
        """
        Generically and precisely detects the Electrical Legend / Key to Symbols table on any blueprint page.
        Accounts for PDF page rotation and transforms text/vector coordinates into rendered pixel space.
        Uses vector table borders first, text cluster analysis second, and template crop anchors as fallback.
        Returns coordinates in pixel space at the specified dpi: {x, y, width, height}
        """
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        doc = fitz.open(str(file_path))
        if page_index < 0 or page_index >= len(doc):
            doc.close()
            return None

        page = doc[page_index]
        trans = page.rotation_matrix * mat
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix_w, pix_h = pix.width, pix.height

        blocks = page.get_text("blocks")

        # 1. Search for explicit legend header keywords
        header_keywords = [
            "electrical legend", "key to symbols", "symbol legend", 
            "electrical layout legend", "symbols legend"
        ]
        headers = []
        for b in blocks:
            text = b[4].lower()
            if any(k in text for k in header_keywords) or ("legend" in text and len(b[4].strip()) < 40):
                r = fitz.Rect(b[:4]) * trans
                headers.append((b, r))

        if headers:
            # Prioritize explicit "electrical legend" or "key to symbols"
            headers.sort(
                key=lambda item: 0 if any(k in item[0][4].lower() for k in ["electrical legend", "key to symbols"]) else 1
            )
            primary_b, hr = headers[0]

            # 2. Check vector drawings for an enclosing table border rectangle around this header
            drawings = page.get_drawings()
            candidate_tables = []
            for d in drawings:
                dr = d["rect"] * trans
                # Must encompass header horizontally (with 15px leeway) and vertically start near/above header and extend down
                # Must not be the entire page border (e.g. width < 45% of page width, or height < 45% of page height)
                if (dr.x0 <= hr.x0 + 15 and dr.x1 >= hr.x1 - 15 and
                    dr.y0 <= hr.y0 + 35 and dr.y1 >= hr.y1 + 250 and
                    dr.width < pix_w * 0.45):
                    candidate_tables.append(dr)

            if candidate_tables:
                # Pick the largest candidate table rectangle that fits the column
                candidate_tables.sort(key=lambda r: r.width * r.height, reverse=True)
                tbl = candidate_tables[0]
                doc.close()
                margin = 10.0
                return {
                    "x": float(max(0.0, tbl.x0 - margin)),
                    "y": float(max(0.0, tbl.y0 - margin)),
                    "width": float(tbl.width + margin * 2),
                    "height": float(tbl.height + margin * 2)
                }

            # 3. Fallback: cluster text blocks in the rotated pixel space
            sym_keywords = [
                "socket", "switch", "downlight", "pendant", "spur", "fuse", "detector",
                "isolator", "shaver", "tap", "extract", "bell", "plate", "thermostat",
                "consumer", "ont", "fibre", "telephone", "coaxial", "light", "data", "tv", "legend"
            ]
            
            # Determine if vertical column or horizontal band
            col_blocks = []
            row_blocks = []
            for b in blocks:
                r = fitz.Rect(b[:4]) * trans
                # Check column alignment
                if abs((r.x0 + r.x1) / 2.0 - (hr.x0 + hr.x1) / 2.0) < max(hr.width / 2.0 + 120.0, 260.0):
                    col_blocks.append(r)
                # Check row alignment
                if abs((r.y0 + r.y1) / 2.0 - (hr.y0 + hr.y1) / 2.0) < max(hr.height / 2.0 + 120.0, 260.0):
                    row_blocks.append(r)

            target_blocks = col_blocks if len(col_blocks) >= len(row_blocks) else row_blocks
            if not target_blocks:
                target_blocks = [hr]

            doc.close()
            margin = 35.0
            bx0 = max(0.0, min(r.x0 for r in target_blocks) - margin)
            by0 = max(0.0, min(r.y0 for r in target_blocks) - margin)
            bx1 = min(float(pix_w), max(r.x1 for r in target_blocks) + margin)
            by1 = min(float(pix_h), max(r.y1 for r in target_blocks) + margin)

            return {
                "x": float(bx0),
                "y": float(by0),
                "width": float(bx1 - bx0),
                "height": float(by1 - by0)
            }

        doc.close()

        # Fallback anchor: if user cropped a template whose position indicates a legend strip
        if template_crop_coords:
            tx = float(template_crop_coords["x"])
            ty = float(template_crop_coords["y"])
            tw = float(template_crop_coords["width"])
            th = float(template_crop_coords["height"])
            # Expand by 120px around the crop
            return {
                "x": max(0.0, tx - 120.0),
                "y": max(0.0, ty - 120.0),
                "width": tw + 240.0,
                "height": th + 240.0
            }

        return None

    @staticmethod
    def get_thumbnail(file_path: str | Path, page_index: int) -> Path:
        """Render a lightweight thumbnail for sidebar navigation."""
        file_path = Path(file_path)
        cache_key = f"{file_path.stem}_thumb_p{page_index}.jpg"
        out_path = CACHE_DIR / cache_key
        if out_path.exists():
            return out_path

        doc = fitz.open(str(file_path))
        page = doc[page_index]
        zoom = 45.0 / 72.0  # ~45 DPI thumbnail
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        pix.save(str(out_path))
        doc.close()
        return out_path

    @staticmethod
    def export_annotated_pdf(
        source_pdf: str | Path, 
        output_pdf: str | Path, 
        markers_by_page: Dict[int, List[Dict[str, Any]]],
        legends_map: Dict[str, Dict[str, Any]],
        image_dpi: int = 200
    ) -> str:
        """Inject confirmed visual takeoff annotation overlays directly into the original vector PDF."""
        source_pdf = Path(source_pdf)
        output_pdf = Path(output_pdf)
        output_pdf.parent.mkdir(parents=True, exist_ok=True)
        
        doc = fitz.open(str(source_pdf))
        scale = 72.0 / image_dpi  # Convert image pixels back to PDF points
        
        for page_idx, markers in markers_by_page.items():
            if page_idx >= len(doc):
                continue
            page = doc[page_idx]
            
            for m in markers:
                legend = legends_map.get(m.get("legend_id", ""), {})
                color_hex = legend.get("color", "#2563EB")
                rgb = hex_to_rgb(color_hex)
                label = legend.get("label", "Electrical Symbol")
                
                # Image coordinates
                x = m.get("x", 0) * scale
                y = m.get("y", 0) * scale
                w = m.get("width", 30) * scale
                h = m.get("height", 30) * scale
                
                # Create highlight rectangle
                rect = fitz.Rect(x, y, x + w, y + h)
                annot = page.add_rect_annot(rect)
                annot.set_colors(stroke=rgb, fill=rgb)
                annot.set_opacity(0.4)
                annot.info["content"] = f"{label} (Confidence: {int(m.get('confidence_score', 1.0) * 100)}%)"
                annot.update()
                
                # Add text badge
                text_rect = fitz.Rect(x, max(0, y - 10), x + 80, y)
                txt_annot = page.add_freetext_annot(
                    text_rect, 
                    label[:15], 
                    fontsize=6, 
                    text_color=rgb, 
                    fill_color=(1, 1, 1)
                )
                txt_annot.update()

        doc.save(str(output_pdf))
        doc.close()
        return str(output_pdf)
