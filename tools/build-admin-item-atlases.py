#!/usr/bin/env python3
"""Build lightweight Admin-only thumbnail atlases from mobile item artwork."""

from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/mobile/assets/items/each"
OUTPUT = ROOT / "apps/admin/public/item-atlas"
GENERATED = ROOT / "apps/admin/src/generated/item-atlas.json"
METADATA = ROOT / "packages/engine/src/items/rule-metadata.json"
FIRST_ROW = 2
COUNT = 5439
CELL = 64
COLUMNS = 10
ITEMS_PER_PAGE = 100


def row_number(path: Path) -> int:
    match = re.match(r"memory\.(\d{4})_", path.name)
    if not match:
        raise ValueError(f"Unexpected item filename: {path.name}")
    return int(match.group(1))


def main() -> None:
    catalog_version = json.loads(METADATA.read_text())["version"]
    paths = sorted(SOURCE.glob("memory.*.webp"), key=row_number)
    actual = [row_number(path) for path in paths]
    expected = list(range(FIRST_ROW, FIRST_ROW + COUNT))
    if actual != expected:
        missing = sorted(set(expected) - set(actual))
        raise ValueError(f"Expected consecutive item rows {FIRST_ROW}-{FIRST_ROW + COUNT - 1}; missing {missing[:10]}")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    for old in OUTPUT.glob(f"{catalog_version}-*.webp"):
        old.unlink()

    sheet_size = COLUMNS * CELL
    for page_start in range(0, COUNT, ITEMS_PER_PAGE):
        sheet = Image.new("RGBA", (sheet_size, sheet_size), (0, 0, 0, 0))
        for slot, path in enumerate(paths[page_start:page_start + ITEMS_PER_PAGE]):
            with Image.open(path) as source:
                icon = source.convert("RGBA")
                icon.thumbnail((CELL - 4, CELL - 4), Image.Resampling.LANCZOS)
                x = (slot % COLUMNS) * CELL + (CELL - icon.width) // 2
                y = (slot // COLUMNS) * CELL + (CELL - icon.height) // 2
                sheet.alpha_composite(icon, (x, y))
        page = page_start // ITEMS_PER_PAGE
        sheet.save(OUTPUT / f"{catalog_version}-{page:02d}.webp", "WEBP", lossless=True, method=6)

    GENERATED.parent.mkdir(parents=True, exist_ok=True)
    GENERATED.write_text(json.dumps({
        "catalogVersion": catalog_version,
        "firstRow": FIRST_ROW,
        "count": COUNT,
        "columns": COLUMNS,
        "itemsPerPage": ITEMS_PER_PAGE,
        "cellSize": CELL,
    }, indent=2) + "\n")
    print(f"Built {(COUNT + ITEMS_PER_PAGE - 1) // ITEMS_PER_PAGE} atlas pages for {COUNT} icons")


if __name__ == "__main__":
    main()
