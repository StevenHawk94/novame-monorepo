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

The current rule source is `Icon_Mapping_Core_Tables_v33.xlsx`. This data-only
revision keeps all 5,439 icon IDs, artwork, and Reflect category assignments.
The data builder does not rewrite the image map or recrop images. Do not run the
image builder for keyword-only updates. Validation is recorded in
`items-v33-data-qa.json`; the v31 image QA still describes the unchanged artwork.
v33 adds 1,275 explicit AUTO / Phrase triggers across 51 icons while preserving
v32's bare-word restrictions, exclusions, and conflict resolutions. Running and
Neutral retain their existing coverage without another expansion.

`Icon_Mapping.keywords_mapping` supplies icon metadata; `Keyword_Safety` is the
authority for executable matching rules. `NEVER_AUTO` entries are not promoted
to triggers, and non-executable prose exclusions remain fail-closed. Cross-icon
keyword collisions must be explicitly resolved in `CONFLICT_WINNERS`, rather
than silently selecting whichever spreadsheet row happens to come last.

Fifteen Tap Your Day artworks are now the canonical files for their existing
memory item IDs. `build-items-v19.py` reapplies these promotions after a full or
affected targeted rebuild; do not restore the retired presentation-only runtime
map. The five `tap.person.*` choices remain separate selection-only items.
