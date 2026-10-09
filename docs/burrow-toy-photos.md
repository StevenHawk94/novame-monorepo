# Per-toy face photos

Each user's toy costume (`catalog_items.stable_id`) owns a separate face crop.
An unphotographed newly purchased toy renders without a face. Switching back
restores the original toy's photo; Collection, Home, preview and interaction use
the same strict `ownerId + toyId` selector. No legacy/unscoped photo fallback.

- Camera overlays use the selected costume's measured `photoBounds`.
- Upload tickets bind actor, owner, pairing, toy ID, digest and idempotency key.
- Photo changes are limited once per toy per local day (camera and library share
  that toy's allowance); one toy cannot block another's initial photo.
- Retry drafts include the toy ID. Old user-global drafts are never attached
  automatically to a different costume.
- Confirmed photo receipts replace only that toy's metadata. Version-keyed
  private document files remain reusable across switches and restarts.
- Replaced/failed private objects use the existing bounded garbage collection.

## Rollout

Apply `20261008000205_burrow_per_toy_photos.sql`, then deploy the updated API and
mobile code. This change is not functional against the old database/API alone.
The migration retains each existing photo's ID, path and version, binds it only
to the currently equipped toy, and does not copy it to other owned costumes.
Frames remain on their existing upload/read/cleanup path.

## Production execution — 2026-10-08

- Applied only `20261008000205` to linked Supabase project
  `qleeohkhbrdvznbwgqad`. Recent prerequisites through `20261008000204` were
  already recorded; historical migration differences were not replayed.
- Used an explicit transaction, advisory migration lock and lock/statement
  deadlines. The history insert committed in the same transaction. A transaction
  assertion confirmed all existing photo IDs, private paths and update versions
  stayed unchanged: 10 photos retained, including 5 doll photos now scoped to
  their equipped toys; no unbound doll photos remain. All 11 upload tickets remain.
- Verified per-toy uniqueness/daily-quota indexes, updated legacy frame/solo
  conflict handling, service-only RPC permissions and authenticated `toy_id`
  read permission. Authenticated clients still cannot read `private_path`.
- API production deployment `dpl_8ASVetdCtk2rjmnw5zAGq21rmxkw` is **READY**.
  Both the project's production target and the `api.soulsayit.com` alias point
  to it. Existing private-media cleanup schedules remain configured.
- The CLI lost its final status connection after the cloud build, so completion
  was independently verified through Vercel's deployment/project/alias APIs;
  no duplicate deployment was needed.
- Production photo GET/POST, bootstrap and Surprise anonymous checks returned
  401. No real user photo was uploaded/replaced, purchase made or message sent
  during verification. Authenticated real-device end-to-end testing remains.
- Re-ran 12 targeted per-toy API/mobile/actual-SQL tests and 37 existing
  photo/collection regressions successfully. Vercel production build passed.
- No mobile binary or OTA update was published. Existing installed releases
  need the updated mobile client to expose the per-toy Collection/photo flow.

Verification: `pnpm test:toy-photos`, `pnpm test:toy-collection`,
`pnpm test:reliability`, and `pnpm test:toy-photos:db` (requires PGlite; set
`PGLITE_MODULE` to an installed module path if not locally resolvable).
