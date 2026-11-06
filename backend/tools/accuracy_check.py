"""
Accuracy check: Plotline's automatic count vs a finished Jeffway workbook, house type by house type.

    cd backend
    python tools/accuracy_check.py --workbook "../Report 4 Excel Sheets/<tender>.xlsx" \
        --house Avebury=/path/The\ Avebury.pdf --house Bruton=/path/Bruton.pdf [--cache /tmp/acc] [--matcher-only]

For each house type: the sheets the app would pick (sheet classifier "yes") are matched exactly as the
pipeline does, the free checks run (services/sheet_checks.py, same code as the pipeline), and the count
(score >= 0.80, no AI, nobody reviewing) is compared with column A of the workbook tab of the same name,
row by row through each library symbol's sheet_row. First-pass matches are cached per sheet (slow part).

Reports per house: miscount (sum of |ours - Jeffway| over rows the library maps to), over / under, lines
exactly right, and how many marks would still go to the AI check.
"""
from __future__ import annotations

import argparse
import collections
import copy
import hashlib
import json
import sys
from pathlib import Path

import cv2
import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import pipeline_service as ps  # noqa: E402
from app.services.pdf_service import PDFService  # noqa: E402
from app.services.sheet_checks import TenderChecks  # noqa: E402
from app.vision.template_matcher import GeometricVisionMatcher  # noqa: E402

COUNTED_AT = 0.80
AUTO_HIGH = 0.85


def first_pass(pdf: Path, page: int, syms, order, label_tokens, cache: Path):
    key = hashlib.md5(f"{pdf.resolve()}:{page}:{len(syms)}".encode()).hexdigest()[:12]
    f = cache / f"{pdf.stem}.p{page}.{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    unique = {}
    for s in syms:
        unique.setdefault(s["template_image_b64"], s)
    img = cv2.imread(str(PDFService.render_page_image(pdf, page, 200)[0]))
    zone = ps._trusted_legend_zone(pdf, page, img)
    marks = []
    for s in unique.values():
        lid = ps._legend_from_symbol(s)["legend_id"]
        for m in GeometricVisionMatcher.match_symbol(
                "", {"x": 0, "y": 0, "width": 10, "height": 10}, lid, scales=[0.9, 1.0, 1.1], angles=[0, 90, 180, 270],
                min_confidence=0.55, excluded_zones=[zone] if zone else None,
                template_bgr_override=ps._decode_b64(s["template_image_b64"]), image_bgr_override=img):
            m["confidence_score"] = round(float(m["confidence_score"]), 3)
            marks.append(m)
    lines = ps._sheet_text_lines(pdf, page)
    marks = [m for m in marks if not ps._is_legend_entry(m, lines, label_tokens)]
    out = {"zone": zone, "marks": ps._cross_symbol_dedupe(marks, order)}
    f.write_text(json.dumps(out))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", required=True)
    ap.add_argument("--house", action="append", required=True, help="TabName=path/to/house.pdf")
    ap.add_argument("--cache", default="/tmp/plotline_accuracy")
    ap.add_argument("--matcher-only", action="store_true", help="skip the free checks (baseline)")
    a = ap.parse_args()
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)

    syms = ps._library_symbols()
    lib = {ps._legend_from_symbol(s)["legend_id"]: s for s in syms}
    order = {k: i for i, k in enumerate(lib)}
    label_tokens = [ps._tokens(ps._legend_from_symbol(x)["label"] + " " + (x.get("sheet_desc") or "")) for x in syms]
    label_tokens += [ps._tokens(x.get("cad_label") or "") for x in syms]
    rows = collections.defaultdict(list)
    for lid, s in lib.items():
        if s.get("sheet_row"):
            rows[int(s["sheet_row"])].append(lid)
    wb = openpyxl.load_workbook(a.workbook, data_only=True)
    checks = TenderChecks(syms, ps._legend_from_symbol)
    total = collections.Counter()

    for spec in a.house:
        name, path = spec.split("=", 1)
        pdf = Path(path)
        pages = [p for p in PDFService.inspect_pdf(str(pdf))["pages"] if p["evidence"]["verdict"] == "yes"]
        sheets = []
        for p in pages:
            fp = first_pass(pdf, p["page_index"], syms, order, label_tokens, cache)
            ms = copy.deepcopy(fp["marks"])
            for m in ms:
                m["status"] = "ai_unverified" if m["confidence_score"] >= AUTO_HIGH else "needs_review"
            if not a.matcher_only:
                zone, lines = fp["zone"], ps._sheet_text_lines(pdf, p["page_index"])

                def not_legend(m, zone=zone, lines=lines):
                    cx, cy = m["x"] + m["width"] / 2, m["y"] + m["height"] / 2
                    if zone and zone["x"] - 5 <= cx <= zone["x"] + zone["width"] + 5 and zone["y"] - 5 <= cy <= zone["y"] + zone["height"] + 5:
                        return False
                    return not ps._is_legend_entry(m, lines, label_tokens)

                ms = checks.run(pdf, p["page_index"], p["page_number"], ms, AUTO_HIGH, not_legend, p.get("title") or "")
            sheets.append({"pdf": pdf, "page_index": p["page_index"], "title": p.get("title") or "", "marks": ms})
        if not a.matcher_only:
            checks.finish_house(sheets)

        counted = collections.Counter()
        to_ai = 0
        for sh in sheets:
            for m in sh["marks"]:
                if m.get("status") == "possible_missed":
                    continue
                if m["confidence_score"] >= COUNTED_AT:
                    counted[m["legend_id"]] += 1
                elif m["confidence_score"] >= 0.6 and m.get("status") in ("needs_review", "ai_unverified"):
                    to_ai += 1
        ws = wb[name]
        err = over = under = exact = n = truth = 0
        print(f"\n== {name}  (sheets: {', '.join(str(p['page_number']) + ' ' + (p.get('title') or '') for p in pages)})")
        for r, lids in sorted(rows.items()):
            t = int(ws.cell(r, 1).value or 0)
            c = sum(counted[l] for l in lids)
            if not (t or c):
                continue
            n += 1
            err += abs(c - t)
            over += max(0, c - t)
            under += max(0, t - c)
            exact += c == t
            truth += t
            print(f"   r{r:<3} {str(ws.cell(r, 4).value)[:42]:42s} Jeffway {t:>3}  ours {c:>3}{'' if c == t else '  <<'}")
        print(f"   miscount {err} on {truth} items (over {over}, under {under}); lines exactly right {exact}/{n}; marks left for AI {to_ai}")
        total.update({"err": err, "truth": truth, "over": over, "under": under, "exact": exact, "lines": n, "to_ai": to_ai})
    print(f"\nALL: miscount {total['err']} on {total['truth']} items (over {total['over']}, under {total['under']}); "
          f"lines exactly right {total['exact']}/{total['lines']}; marks left for AI {total['to_ai']}")


if __name__ == "__main__":
    main()
