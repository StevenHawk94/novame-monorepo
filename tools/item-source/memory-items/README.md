# Memory item source assets

This directory is development-only and is excluded from EAS build uploads.
The mobile app never reads the source PNG montages, Excel workbooks, preview
HTML, or QA JSON files at runtime.

Runtime outputs live in:

- `apps/mobile/assets/items/each/*.webp`
- `apps/mobile/src/lib/item-images.g.ts`
- `apps/mobile/src/lib/guided-catalog.g.ts`
- `packages/engine/src/items/dictionary.json`

Run `python3 tools/build-items-v19.py` for an incremental image build. It only
creates missing WebPs. Use `--full` only for an intentional complete rebuild.
Run `python3 tools/build-item-data-v19.py` after workbook matching-rule changes.
