#!/usr/bin/env python3
"""Grid probe for the v3 memory-item pages (2026-07-30).

For every PNG page in tools/item-source/memory-items, draw the assumed grid (8 cols x
rows-per-page derived from the master xlsx) and save an annotated copy into
the scratch dir. Pages whose cells are far from square are flagged — those
get eyeballed before slicing.
"""
import sys
from collections import defaultdict
from pathlib import Path

import openpyxl
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'item-source' / 'memory-items'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/item-grid-probe')
OUT.mkdir(parents=True, exist_ok=True)

wb = openpyxl.load_workbook(SRC / 'icon_keyword_mapping_final.xlsx', read_only=True)
ws = wb['icon_keyword_mapping_final']
rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[5]]

total_rows = defaultdict(int)
for r in rows:
    total_rows[r[1]] = max(total_rows[r[1]], (r[3] or 0) + 1)

flagged = []
for cat, R in sorted(total_rows.items()):
    pages = sorted(SRC.glob(f'{cat}-*.png'), key=lambda p: int(p.stem.rsplit('-', 1)[1])) \
        or [SRC / f'{cat}.png']
    P = len(pages)
    for i, page in enumerate(pages):
        if not page.exists():
            print(f'MISSING FILE: {page.name}')
            continue
        rows_here = 8 if i < P - 1 else R - 8 * (P - 1)
        im = Image.open(page).convert('RGBA')
        W, H = im.size
        cw, ch = W / 8, H / rows_here
        ratio = cw / ch
        d = ImageDraw.Draw(im)
        for c in range(1, 8):
            d.line([(c * cw, 0), (c * cw, H)], fill=(255, 0, 0, 255), width=3)
        for rr in range(1, rows_here):
            d.line([(0, rr * ch), (W, rr * ch)], fill=(255, 0, 0, 255), width=3)
        im.convert('RGB').save(OUT / f'{page.stem}__{rows_here}rows.jpg', quality=80)
        note = ' <-- CHECK (cells not square)' if not 0.72 <= ratio <= 1.38 else ''
        print(f'{page.name}: {W}x{H}, rows={rows_here}, cell={cw:.0f}x{ch:.0f}, ratio={ratio:.2f}{note}')
        if note:
            flagged.append(page.stem)

print('\nflagged:', flagged if flagged else '(none)')
