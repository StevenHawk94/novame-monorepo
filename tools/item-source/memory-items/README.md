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
creates missing WebPs. To intentionally replace a suffix from updated source
pages without touching earlier icons, use for example:

`python3 tools/build-items-v19.py --source-dir tools/item-source/memory-items/新icons --replace-from-row 1374`

Use `--full` only for an intentional complete rebuild.
Run `python3 tools/build-item-data-v19.py` after workbook matching-rule changes.
