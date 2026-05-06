# Growth tab assets

Bundle-shipped images used by the Growth tab.

| Filename | Used by | Description |
|---|---|---|
| `task-banner.webp` | `src/components/growth/exp-banner.tsx` | Yellow ribbon banner background ("Grow with Your Pal" art) |
| `focus-icon.webp` | `src/components/growth/focus-mode-card.tsx` | Octagonal lightning icon shown in the Focus Mode card |

**Adding the assets:** drop the .webp files into this directory, then
flip the `USE_REAL_ASSETS` flag (or remove the flag entirely) in the
two component files above. Components currently render a CSS-only
placeholder when the file is absent so the build stays green.
