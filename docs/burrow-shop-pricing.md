# Bundled Shop catalog and Admin pricing

## Scope

Admin → **Shop Pricing** lists active Shop products in the live content revision, with category/search, local-art previews, IDs, descriptions, Plus/gift flags, current carrot prices, single/batch editing and recent audit history. A history entry can restore its old price into a draft for review and normal save. Free/default products remain read-only; paid prices are integers from 1 to 1,000,000 carrots, up to 200 changes per save.

This panel cannot create/delete products, upload/replace artwork, change availability, or edit cash prices for subscriptions/carrot packs. Existing ownership, gifts, purchase snapshots and saved room layouts are not rewritten.

## Sources of truth

- Mobile art: `apps/mobile/assets/burrow-webp` and the literal `burrow-art-assets.ts` registry. No R2 fetches or remote image overrides were introduced.
- Products and carrot prices: `catalog_items`, filtered by `app_major_update_content_revision`. Price edits do not require another mobile release once the price-aware client below is distributed.
- Admin previews: `node tools/build-admin-shop-assets.cjs` produces byte-identical static WebP copies and a manifest from the mobile registry; Admin's build runs it automatically. CLI deployments exclude the native project and use those pre-generated files after verifying every content hash; the build fails if a preview is missing or corrupt. Wallpaper uses the existing square thumbnail. Code-rendered bunny outfits remain SVG previews. Missing ordinal mappings are explicitly flagged instead of showing a fallback product.
- Audit: `burrow_shop_price_audit`. The trigger records before/after prices and increments `shop_price_version` even for manual SQL price edits. Admin changes additionally record the verified admin, batch ID and optional reason.

## Purchase / edit safety

Admin POST is authenticated against the existing email whitelist, same-origin checked and allowlist validated. Only the service role may execute the pricing RPC or read audit rows. The database independently checks the live published revision, product category/type, paid non-starter status and expected version for every locked row before changing any row. A stale version rejects the entire batch.

The mobile client sends the price it actually displayed. Single purchases (including solo and gifts) and atomic room/outfit checkout compare those quotes under the same transaction locks as wallet debits. A changed price returns `price_changed` (HTTP 409) without spending carrots. Shop refreshes prices silently, retains the selection, and requires another explicit purchase tap. Existing operation idempotency is preserved: retries of an already-committed purchase do not debit again, even after a later price change. Owned items are never charged again.

All three existing purchase functions acquire a shared pricing advisory lock before pair/inventory locks; Admin batches acquire that lock exclusively before row locks. Thus a purchase observes one complete price batch, not a partly updated set. The migration patches only those locked-price boundaries and fails closed on unexpected function definitions.

## Rollout order

1. Apply `supabase/migrations/20261008000203_burrow_shop_pricing.sql` after the existing room-checkout and season migrations. This creates the audit/version machinery and transactional v2 purchase wrappers. It does not change any existing price.
2. Deploy the updated API and Admin. GET reports a clear unavailable state if the migration is absent.
3. Distribute the updated mobile build with displayed-price quotes before making price changes in Admin. Existing clients may still buy never-edited products. Once a product's price has changed, legacy clients without a quote receive `price_confirmation_required` rather than silently paying a new price; they need to update. Merely deploying Vercel does not update an already-installed native app.
4. Save price edits in Admin. Mobile keeps the existing cache-first/silent bootstrap refresh behavior; an already-open cached screen need not change immediately, but its stale-price purchase is rejected safely. There is no automatic retry at a new price.

## Production execution — 2026-10-08

- Applied only migration `20261008000203` to linked project `qleeohkhbrdvznbwgqad`, in one explicit transaction with lock/statement deadlines and the migration-history insert. The recent prerequisite migrations, including `20261007000202`, were already recorded; old historical differences were not replayed.
- Verified all new RPCs, the active audit trigger, service-only mutation privileges, zero price edits and zero audit entries after migration.
- Admin production deployment `dpl_5TVXLuaavWZexQg9aq3BVUmAc4Yt` is **Ready**, aliased to `https://novame-monorepo-admin.vercel.app`. Cloud build verified 320 generated art entries and included `/api/admin/shop-pricing`.
- API production deployment `dpl_J1B9isv67i7HpRw3SGqrF9vvZqMC` is **Ready**, aliased to `https://api.soulsayit.com`.
- Read-only HTTP checks: Admin login 200, sample preview WebP 200, unauthenticated pricing endpoint 401, unauthenticated API bootstrap 401. Authenticated Admin save was not exercised against production, to avoid changing real prices.
- Live directory contains 332 category-matching records, including 307 editable paid products. Seven older adventure/friend reward records have null prices and no independent local art mapping; they are read-only, explicitly flagged, and are not sold by the mobile Shop. Every currently sold non-outfit item has a matching local preview; outfits remain code-rendered.
- No native installation package was published in this deployment. Distribute/use the updated price-aware mobile client before changing prices for users of an older installed build.

## Local verification

`pnpm test:shop-pricing` covers manifest parity, input allowlists, Admin authorization/origin checks, catalog filtering, client quoting, batch UI and preserved drafts after conflicts.

`PGLITE_MODULE=/path/to/@electric-sql/pglite pnpm test:shop-pricing:db` executes the actual migration (twice) and real existing purchase SQL in isolated PostgreSQL/WASM, with focused support fixtures. It checks batch atomicity, audit/versioning, manual-edit protection, solo/paired/gift/room/outfit purchases, idempotency, ownership, quote cleanup and privilege grants. It does not contact Supabase or simulate multi-session lock scheduling.
