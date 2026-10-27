# Bookshelf gift collection

The Home `shelf_decor` hotspot now opens a full-screen brown/cream paper card
with a tape heading, not the old category-chip page sheet. Its first level is
the existing 15 gift categories in three columns (five rows, scrollable on short
screens). Categories with no owned gift show `?`, `???`, and zero/actual total.
Unlocked categories show their first acquired gift and distinct collected count.

Opening a category shows all its catalogued rewards in three columns, including
locked `?`/`???` placeholders. Titles and donor names come from the current
catalogue and friend definitions, not screenshot example labels. Selection adds
the brown outline/check and reveals `Place on bookshelves`; selecting a tile
alone never writes. Placement uses the unchanged ownership-checked
`select_adventure_gift_v2` command. Only a successful response shows the supplied
success message; Done closes back to Home. Failures retain selection and permit
retry; duplicate taps, unmounts and account/pair changes are guarded.

After a server-confirmed placement, the shared Home store immediately applies
and persists the selected display. Reads started before, or in the same clock
tick as, that receipt cannot restore the previous shelf gift. Later fresh
snapshots remain authoritative. All local projections clear on identity/pair
invalidation. No inventory, reward, price, trading or payment rules change.

The current library has 483 distinct gifts across 15 categories: most have 32
items and Insect Displays has 35. Screenshot example totals/categories/donors
are not substituted into production data. Acquisition uses `acquired_at`, not
random inventory UUIDs. Paired bootstrap already includes this field; unpaired
bootstrap now selects it too, including paginated inventories. Existing cached
snapshots without it remain readable and update silently.

Gift artwork uses the original complete canvas, including transparent margins.
All 483 supplied gift WebPs are 600 × 600. Reward cards and both room renderers
no longer resize each silhouette to fill a target width/height; bookshelf gifts
share one canvas placement. The collection already uses `contain`. No original
image is rewritten or stretched, and the requested opening rebound is unchanged.

## Verification and release scope

- Targeted collection/Home/cache/pairing/Adventure/bootstrap regressions:
  104 passed (`/private/tmp/novame-gift-shelf-regression-final.log`).
- Full CJS regression: 1,653 passed, 0 failed. API production build and mobile
  TypeScript checks passed. Both Android and iOS production JS bundles passed;
  evidence: `/private/tmp/novame-gift-shelf-bundles-final.log`.
- iOS SE native QA used a separate local app, local reward pictures and mocked
  in-memory placement, with external application requests blocked. Inspected
  overview, first-acquired representative, donor/header, locked list, selected
  outline/check, fixed placement button, success overlay and Done closure.
  This is not a production account placement test.
- Mobile TypeScript and both production JS bundles are checked separately;
  Android simulator is skipped. Full CJS/API-build evidence lives at
  `/private/tmp/novame-gift-shelf-full-tests.log` and
  `/private/tmp/novame-gift-shelf-api-build.log`.
- 2026-10-16 API production release:
  `dpl_H2f1YUY78AeeAZhgEhDw7gECCNJt`, READY and aliased to
  `https://api.soulsayit.com`. The only API source delta from the preceding
  production snapshot is selecting `acquired_at` on both initial and paginated
  unpaired inventory reads. No migration or Admin/mobile distribution.
- Production acceptance uses two disposable accounts, first separately and then
  paired: reversed UUID/acquisition ordering, personal collection counts, shelf
  replacement visible in both Home reads, foreign/unowned item rejection,
  concurrent duplicate placement, fresh authenticated sessions, and the actual
  mobile cache codec reloaded in a new module realm. Wallet balance/version and
  ledger are unchanged. All seven acceptance checks passed; test accounts and
  owned fixture data were removed and absence rechecked. Evidence:
  `/private/tmp/novame-gift-shelf-production-final.json`.
- Final canvas revision: 1,655 CJS tests passed, 0 failed; eight API/bootstrap
  tests and mobile TypeScript checks passed. Both production JS bundles passed.
  Evidence: `/private/tmp/novame-gift-canvas-full-tests.log`,
  `/private/tmp/novame-gift-api-final-tests.log`,
  `/private/tmp/novame-gift-canvas-types.log`,
  `/private/tmp/novame-gift-canvas-bundles.log`.
- iOS SE native restart acceptance used the isolated `com.novame.localuiqa`
  app, real MMKV/cache codec, Home renderer and collection component. Synthetic
  snapshots were captured from the verified production API; gift artwork used
  the identical bundled originals, while photos/environment/auth networking
  were isolated. Force-terminate/relaunch restored unpaired Elephant Statue and
  paired Cat Statue on the bookshelf; first-acquired representative remained
  Elephant Statue with 2/32, and the Kiki list retained both owned pictures and
  locked placeholders. This verifies actual on-device disk restoration, not an
  additional end-to-end live-auth native transaction.
- QA entry/config/mocks are outside the repository; the QA app/server are
  stopped after inspection. Run `pnpm test:gift-shelf` for the focused suite.
