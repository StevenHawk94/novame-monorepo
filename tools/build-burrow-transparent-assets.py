"""Make render-only alpha copies of three supplied RGB Burrow decorations.

The source files stay untouched. This removes only border-connected near-white
pixels, so white details enclosed by the illustration are preserved.
"""

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1] / "apps/mobile/assets"
SOURCES = {
    "burrow-webp/room decoration/cusion/1.webp": "burrow-rendered/cushion-1.webp",
    "burrow-webp/room decoration/succulent on dresser/85.webp": "burrow-rendered/dresser-plant-85.webp",
    "burrow-webp/room decoration/succulent on dresser/91.webp": "burrow-rendered/dresser-plant-91.webp",
}


def transparent_border(source: Path, destination: Path) -> None:
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def background_candidate(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        return min(red, green, blue) >= 228 and max(red, green, blue) - min(red, green, blue) <= 24

    def add(x: int, y: int) -> None:
        index = y * width + x
        if not visited[index] and background_candidate(x, y):
            visited[index] = 1
            queue.append((x, y))

    for x in range(width):
        add(x, 0)
        add(x, height - 1)
    for y in range(height):
        add(0, y)
        add(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (0, 0, 0, 0)
        if x > 0:
            add(x - 1, y)
        if x + 1 < width:
            add(x + 1, y)
        if y > 0:
            add(x, y - 1)
        if y + 1 < height:
            add(x, y + 1)

    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "WEBP", lossless=True)
    print(f"{destination.relative_to(ROOT)}: {image.getbbox()}")


for original, rendered in SOURCES.items():
    transparent_border(ROOT / original, ROOT / rendered)
