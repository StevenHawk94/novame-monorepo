# Bundled Shop catalog

`burrow-shop-products.json` is the only authoring source for product identity,
name, category, artwork, render geometry, lifecycle and initial seed settings.
Artwork remains in the native App bundle. There is no product CDN, runtime image
manifest download or startup download of the Shop catalog.

## Editing products

- Add: allocate a new permanent `id`, add local artwork and complete its manifest
  entry. Prefer a descriptive UUID-based ID; never derive identity from an array
  index, filename, price or current display order.
- Rename or replace artwork: edit the existing entry, retaining its ID. The
  generator hashes actual bytes, detecting a file replaced at the same path.
  Update visible/photo bounds when its shape changes. Surprise face geometry is
  recalculated automatically from changed image bytes.
- Remove from sale: set `status` to `retired`. Keep the entry and artwork because
  purchases, loadouts, gifts, rewards and histories can still reference it.
  `draft` entries are not offers or Adventure candidates.
  Exception approved 2026-10-26: the 28 test-era Dresser/Wallpaper entries marked
  `retiredArtRemoved` in the identity ledger have no bundled art/thumbnail or
  Admin preview. Their IDs and financial/history records remain; historical
  artwork renders empty, including stale cached ordinals. This is a bounded
  exception, not permission to delete artwork for other retired products.
- Do not edit generated registries, Admin previews, historical migrations or the
  append-only identity ledger to perform routine product updates.
- `node tools/refresh-shop-art.cjs --apply` reconciles the Dresser/Wallpaper
  authoring folders using explicit same-name/default matching. It allocates a
  UUID for each new style, archives verified old bytes for retired ownership,
  updates alpha bounds and rebuilds Wallpaper thumbnails. Missing old art must
  match the prior release fingerprint before it can be archived from Git.
  Existing compatibility ordinals are retained; new ones are appended, not reused.
- A new game also needs its real questions in the existing game-content source.
  The pipeline cannot invent questions. A new render category is a feature
  change, not a routine product addition.

Run `pnpm catalog:prepare` once. It validates IDs and local files and generates:

1. Permanent-ID mobile artwork, compatibility registries, outfit layers, game
   icons, Surprise frames, face geometry and send whitelists.
2. Admin previews/product mappings and game question details.
3. API bundle-capability index and one transactional publication SQL artifact.

`pnpm catalog:check` rejects missing art, stale outputs, deleted/reused IDs and
unexpected geometry. API builds and supported local EAS commands also check it.
Admin authoring builds run the same sync. Legacy art/service generation commands
now delegate here instead of assigning IDs or rewriting applied migrations.

## Publication and compatibility

This prepares one catalog publication, not an unapproved production deployment.
After approval: apply migration 259 once, deploy matching API/Admin artifacts,
release the supporting App, then execute `generated/shop-catalog-release.sql`.
Keep the existing minimum-App-version/force-update release policy. Never publish
an unsupported product first and expect an old bundle to download its image.

Publication updates presentation/status atomically, preserving existing Admin
prices, Plus flags, tradability, ownership and receipts. `seed` settings apply
only to newly inserted rows. It does not advance the global content revision.

The App reports its compiled catalog hash. Missing/unknown hashes use the frozen
legacy capability list, never the latest list. Shop offers and new Adventure
treasure candidates are filtered by supported IDs. Since repair 262, retired
products are not supplemented into the active catalog or offered for placement,
including owned products. Historical inventory/receipts remain untouched; old
equipped art falls back to the current default. Normal authoring is updates and
new additions, not retirement. A binary update is
still required to see replaced image bytes. Existing gift-notification readiness
checks continue to withhold any gift whose art is absent from that bundle.

Adventure still excludes Outfits/Wallpapers/Plushies/Games/Surprises, includes
50/100-coin tickets and falls back to 100 coins when no eligible item remains.
Only unstarted chest reservations refresh. Bound/revealed/claimed rewards and
friend reservations remain unchanged, as do durations and notifications.

## Purchase checkout (262)

Room edits journal only changed slots and their approved quotes. The scoped
`purchase_room_changes_v1` transaction purchases missing items and updates those
slots atomically, retaining the partner's latest other slots. Obsolete hidden
default slots never enter the financial payload. Old full-room commands remain
supported, with invisible legacy slots removed at the API boundary.

Self purchases and gifts use an independent durable debit queue and scoped
receipt. Local acceptance reserves coins, projects self ownership and displays
the acknowledgement immediately. Background retries reuse the exact intent/key;
they never invent confirmed currency or delivery. Definitive rejection clears
only the corresponding projection. A dependent equip waits for its purchase or
gift receipt; it cannot silently buy an unconfirmed item with a zero quote.
Receipt replay cannot equip an obsolete design, change recipient, or debit twice.
Wallet `spends` keys reconcile pending reservations after lost responses.

Regression entry points: `tools/test-shop-checkout262-api.cjs`,
`tools/test-room-edit-store.cjs`, `tools/test-room-edit-queue.cjs`, and isolated
`tools/test-shop-checkout262-database.mjs` (`BURROW_PGLITE_PATH` required).

## Failure recovery and verification

Malformed publication raises an error and rolls back the entire statement.
Exact replays are idempotent. To restore a saved server catalog, call
`rollback_burrow_shop_catalog_v1(previous_release_hash)` as service role. It
restores presentation/status, retires newer IDs without deleting ownership,
keeps current Admin prices and never rerolls a bound chest. Client image bytes
are bundled: reverting those needs a matching App build, not a server toggle.

Run `pnpm test:shop-catalog`, mobile type checking, API/Admin production builds,
asset-reference checks and an iOS export. `pnpm test:shop-catalog:db` requires
`BURROW_PGLITE_PATH` pointing to an isolated PGlite runtime. Tests never connect
to production.

The initial import retains 31 historical retired rows whose previously removed
legacy art is explicitly grandfathered in the ledger. In addition, the 28
user-approved test-era removals above are individually recorded. Both sets stay
retired; neither permits removing other current/future historical artwork.
