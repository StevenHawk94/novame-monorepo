#!/usr/bin/env python3
"""
normalize-item-sheet.py — turn a hand-arranged item montage into the standard
NovaMe sprite sheet.

Input:  any roughly-grid montage (e.g. the AI-generated 1122x1402 sheets) on a
        near-uniform light background. Spacing may be uneven; items may even
        slightly overlap their neighbours' grid lines.
Output (in <input-dir>/standardized/):
  <name>-standard.png   2048x2048 RGBA, 8x8 grid of 256px cells, transparent
                        background, every item centered with its max dimension
                        scaled to 200px (the 12% safe-area standard)
  <name>-numbered.png   the same sheet over a light grid with 1..64 labels —
                        the reference for filling the item-mapping CSV
  <name>-mapping.csv    n,row,col,itemId,displayName,keywords skeleton

How it works (v2 — component clustering, not grid slicing):
  1. background removal by flood from the borders (tolerance-based), so
     item-interior whites (fried egg, marshmallow) survive
  2. connected-component labeling of the content; components above an area
     threshold are item BODIES, expected to number rows*cols
  3. bodies are sorted into rows by y-gap clustering, then by x within each
     row — that ordering IS the 1..64 numbering
  4. small components (steam wisps, crumbs, sparkles) attach to the nearest
     body by bbox distance
  5. each item is cropped through a mask of ONLY its own components, so a
     neighbour poking into the bounding box can never bleed in
  6. scale to fit 200, center in its 256 cell

Usage: python3 normalize-item-sheet.py <input.png> [--cols 8 --rows 8]
"""
import argparse
import csv
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

CELL = 256
SAFE = 200  # max item dimension inside a cell (≈12% padding each side)
MIN_BODY_AREA = 900  # px² — smaller components are fragments to attach


def flood_background(rgb: np.ndarray, tol: int = 26) -> np.ndarray:
    """Boolean mask of background pixels connected to the border."""
    ring = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(ring, axis=0)
    close = (np.abs(rgb.astype(int) - bg.astype(int)).max(axis=2) <= tol)
    seed = np.zeros(close.shape, bool)
    seed[0], seed[-1], seed[:, 0], seed[:, -1] = True, True, True, True
    seed &= close
    # scipy flood: one labeled pass over `close`, keep labels touching border.
    lab, _ = ndimage.label(close)
    border_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    border_labels = border_labels[border_labels != 0]
    return np.isin(lab, border_labels)


def bbox_distance(a, b) -> float:
    """Gap between two bboxes (y0,x0,y1,x1); 0 if they overlap."""
    ay0, ax0, ay1, ax1 = a
    by0, bx0, by1, bx1 = b
    dy = max(by0 - ay1, ay0 - by1, 0)
    dx = max(bx0 - ax1, ax0 - bx1, 0)
    return float(np.hypot(dx, dy))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--cols", type=int, default=8)
    ap.add_argument("--rows", type=int, default=8)
    args = ap.parse_args()
    want = args.cols * args.rows

    src = Image.open(args.input).convert("RGB")
    rgb = np.asarray(src)
    h, w, _ = rgb.shape
    print(f"input {w}x{h}, target {args.cols}x{args.rows}")

    bg = flood_background(rgb)
    content = ~bg

    # Components. 8-connectivity so thin diagonal strokes stay whole.
    lab, n = ndimage.label(content, structure=np.ones((3, 3), int))
    slices = ndimage.find_objects(lab)
    comps = []
    for i, sl in enumerate(slices, start=1):
        area = int((lab[sl] == i).sum())
        bbox = (sl[0].start, sl[1].start, sl[0].stop, sl[1].stop)
        comps.append({"id": i, "area": area, "bbox": bbox})

    bodies = [c for c in comps if c["area"] >= MIN_BODY_AREA]
    frags = [c for c in comps if c["area"] < MIN_BODY_AREA]
    print(f"components: {n} ({len(bodies)} bodies, {len(frags)} fragments)")

    # Too many bodies? Merge the closest pairs until rows*cols remain (an item
    # drawn in two parts — bun halves, a sauce cup next to nuggets).
    while len(bodies) > want:
        best = None
        for i in range(len(bodies)):
            for j in range(i + 1, len(bodies)):
                d = bbox_distance(bodies[i]["bbox"], bodies[j]["bbox"])
                if best is None or d < best[0]:
                    best = (d, i, j)
        _, i, j = best
        a, b = bodies[i], bodies[j]
        merged = {
            "id": [*(a["id"] if isinstance(a["id"], list) else [a["id"]]),
                   *(b["id"] if isinstance(b["id"], list) else [b["id"]])],
            "area": a["area"] + b["area"],
            "bbox": (min(a["bbox"][0], b["bbox"][0]), min(a["bbox"][1], b["bbox"][1]),
                     max(a["bbox"][2], b["bbox"][2]), max(a["bbox"][3], b["bbox"][3])),
        }
        bodies = [c for k, c in enumerate(bodies) if k not in (i, j)] + [merged]
    if len(bodies) != want:
        print(f"WARN found {len(bodies)} bodies, expected {want} — check the output!")

    # Attach fragments to the nearest body (steam to its cup, crumbs home).
    for f in frags:
        nearest = min(bodies, key=lambda b: bbox_distance(b["bbox"], f["bbox"]))
        ids = nearest["id"] if isinstance(nearest["id"], list) else [nearest["id"]]
        ids.append(f["id"])
        nearest["id"] = ids
        b0, b1, b2, b3 = nearest["bbox"]
        f0, f1, f2, f3 = f["bbox"]
        nearest["bbox"] = (min(b0, f0), min(b1, f1), max(b2, f2), max(b3, f3))

    # Order bodies: cluster into rows by the largest y-gaps, then x-sort.
    bodies.sort(key=lambda b: (b["bbox"][0] + b["bbox"][2]) / 2)
    centers_y = [(b["bbox"][0] + b["bbox"][2]) / 2 for b in bodies]
    gaps = sorted(range(len(bodies) - 1), key=lambda k: centers_y[k + 1] - centers_y[k],
                  reverse=True)[: args.rows - 1]
    breaks = sorted(k + 1 for k in gaps)
    row_groups, prev = [], 0
    for brk in [*breaks, len(bodies)]:
        row_groups.append(bodies[prev:brk])
        prev = brk
    ordered = []
    for grp in row_groups:
        ordered.extend(sorted(grp, key=lambda b: (b["bbox"][1] + b["bbox"][3]) / 2))

    # Compose the standard sheet, masking each crop to its own components.
    rgba = np.dstack([rgb, np.where(bg, 0, 255).astype(np.uint8)])
    out = Image.new("RGBA", (CELL * args.cols, CELL * args.rows), (0, 0, 0, 0))
    for idx, body in enumerate(ordered[:want]):
        ids = body["id"] if isinstance(body["id"], list) else [body["id"]]
        y0, x0, y1, x1 = body["bbox"]
        patch = rgba[y0:y1, x0:x1].copy()
        own = np.isin(lab[y0:y1, x0:x1], ids)
        patch[~own, 3] = 0  # neighbours poking into the bbox vanish
        item = Image.fromarray(patch, "RGBA")
        scale = min(SAFE / item.width, SAFE / item.height)
        item = item.resize(
            (max(1, round(item.width * scale)), max(1, round(item.height * scale))),
            Image.LANCZOS,
        )
        r, c = divmod(idx, args.cols)
        out.paste(item, (c * CELL + (CELL - item.width) // 2,
                         r * CELL + (CELL - item.height) // 2), item)

    base = os.path.splitext(os.path.basename(args.input))[0]
    out_dir = os.path.join(os.path.dirname(os.path.abspath(args.input)), "standardized")
    os.makedirs(out_dir, exist_ok=True)

    std_path = os.path.join(out_dir, f"{base}-standard.png")
    out.save(std_path)

    prev_img = Image.new("RGB", out.size, (245, 242, 236))
    prev_img.paste(out, (0, 0), out)
    d = ImageDraw.Draw(prev_img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 40)
    except OSError:
        font = ImageFont.load_default()
    for i in range(args.cols + 1):
        d.line([(i * CELL, 0), (i * CELL, out.height)], fill=(210, 200, 185), width=2)
    for i in range(args.rows + 1):
        d.line([(0, i * CELL), (out.width, i * CELL)], fill=(210, 200, 185), width=2)
    for r in range(args.rows):
        for c in range(args.cols):
            d.text((c * CELL + 10, r * CELL + 6), str(r * args.cols + c + 1),
                   fill=(120, 90, 50), font=font)
    prev_path = os.path.join(out_dir, f"{base}-numbered.png")
    prev_img.save(prev_path)

    csv_path = os.path.join(out_dir, f"{base}-mapping.csv")
    with open(csv_path, "w", newline="") as f:
        wcsv = csv.writer(f)
        wcsv.writerow(["n", "row", "col", "itemId", "displayName", "keywords"])
        for r in range(args.rows):
            for c in range(args.cols):
                wcsv.writerow([r * args.cols + c + 1, r, c, "", "", ""])

    print(f"placed {min(len(ordered), want)}/{want}")
    print(f"-> {std_path}\n-> {prev_path}\n-> {csv_path}")


if __name__ == "__main__":
    sys.exit(main())
