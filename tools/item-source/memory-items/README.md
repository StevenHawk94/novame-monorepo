# Memory item source assets

This directory is development-only and is excluded from EAS build uploads.
The mobile app never reads the source PNG montages, Excel workbooks, preview
HTML, or QA JSON files at runtime.

The complete 5,439-icon development catalog lives in `each/*.webp`. It is used
for R2 publishing, Admin atlases, and rebuilds, and is excluded from EAS uploads.

Runtime outputs live in:

- `apps/mobile/assets/items/each/*.webp` (exactly the 182 current Tap Your Day base icons)
- `apps/mobile/assets/items/tap-person/*.webp` (exactly five dedicated people icons)
- `apps/mobile/src/lib/item-images.g.ts`
- `apps/mobile/src/lib/tap-day-images.g.ts`
- `docs/tap-your-day-icons.txt` (all 187 current display names, IDs and local paths)
- `apps/mobile/src/lib/guided-catalog.g.ts`
- `packages/engine/src/items/display-catalog.json` (historical display-only metadata)

Run `python3 tools/build-items-v19.py` for an incremental image build. It only
creates missing source WebPs, then synchronizes only the current Tap Your Day base icons into the app.
To intentionally replace a suffix from updated source
pages without touching earlier icons, use for example:

`python3 tools/build-items-v19.py --source-dir tools/item-source/memory-items/新icons --replace-from-row 1374`

Use `--full` only for an intentional complete rebuild.
Automatic keyword matching and its data/learning builders have been retired.
Old workbooks and QA reports in this development-only source directory are
archival references, not executable configuration. Do not regenerate keywords.

Use `node tools/build-mobile-item-data.cjs --check` to validate all historical
display IDs and the 187 manual choices. The image/R2 build tools use the
display-only catalog and retain the immutable artwork catalog version.

Fifteen Tap Your Day artworks are now the canonical files for their existing
memory item IDs. `build-items-v19.py` reapplies these promotions after a full or
affected targeted rebuild; do not restore the retired presentation-only runtime
map. The five `tap.person.*` choices remain separate selection-only items.
The eleven formerly duplicated runtime promotion files are now archived in
`canonical-promotions/`, outside the mobile assets folder, so full rebuilds
retain the approved artwork without shipping duplicate copies.

Run `node tools/build-item-icon-assets.mjs` (or the compatibility entry point
`node tools/build-local-tap-icons.cjs`) to regenerate the local maps and name list.
Use `--check` for read-only validation. Removing obsolete runtime copies requires
`--prune`; it refuses to delete any file without a byte-identical development
source. The 124 removed non-Tap runtime copies remain recoverable from `each/`.
Historical item IDs, display metadata, source artwork and existing R2 objects
are unchanged. Only `--inventory` regenerates the full R2 publishing inventory.
Frequency rankings no longer expand the curated mobile asset subset.
