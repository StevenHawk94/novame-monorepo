# Coin sandbox testing

The three coin products are consumables. A different verified transaction for the same product credits again; replaying one transaction never grants twice.

## Current iOS test setup

- Metro/native development-signed iOS builds use Apple Sandbox.
- API: `https://api.soulsayit.com`.
- Vercel API Production target (currently a sandbox test API, not live Apple sales): `BURROW_COIN_PURCHASES_ENABLED=true`, `BURROW_IAP_ENVIRONMENT=sandbox`, `BURROW_COIN_PURCHASE_PLATFORMS=ios`, `BURROW_SANDBOX_COIN_MODE=room`.
- Migration 211 adds an explicit server-only automatic test mode. Any fresh App identity, including an anonymous identity created after reinstall, can receive new, verified sandbox purchases in Home without UUID enrollment. Previously isolated receipts and receipts signed before the policy activation cutoff remain isolated: no historic backfill or reassignment. This mode does not bypass signed receipt verification, App-account ownership, quantities, refunds, or transaction idempotency. Distinct transactions for the same pack continue to credit repeatedly.
- Migration 207 routes ordinary sandbox purchases/refunds to `burrow_sandbox_coin_wallets` and `burrow_sandbox_coin_transactions`. These isolated coins are not spendable and do not appear in Home.
- Migration 208 adds a service-only, explicit tester allowlist (`burrow_coin_sandbox_testers`). This is now a legacy compatibility path when automatic test mode is off; it is not required in the current test configuration. Enrollment is not exposed to mobile clients or a public API.
- Migration 209 supersedes the original 208 enrollment behavior: `set_burrow_coin_sandbox_tester_v1(<confirmed App account UUID>, true)` enrolls only for future purchases and **never backfills**. Already isolated receipts remain isolated on replay. A previously unseen receipt must also be signed after activation to qualify. Repeated enrollment does not reset the activation cutoff. Disabling enrollment isolates new transactions but keeps historic Home receipts on their original wallet for refunds/replays. Receipts retain their true `sandbox` environment; they are never relabeled production. Internal settlement helpers are not callable by the service role directly.
- The checkout preflight describes isolated sandbox mode when applicable. Verified purchases finish as consumables, so the same pack can be purchased repeatedly. Successful Home-wallet verification returns the exact versioned `roomWallet` and, when available, supplementary `coinState`. The mobile client updates its shared coin store immediately, before finishing the Apple transaction, and starts a non-blocking silent Home refresh after durable credit. A pre-payment in-flight read cannot satisfy that refresh; missing supplementary data cannot turn an already committed payment into a failure.
- Existing subscription purchase logic is unchanged. A second Supabase project is not required for this scoped coin test implementation, but the current shared database is not full staging isolation.

## Release boundary

This API configuration accepts sandbox coin receipts only; it is **not** ready for real-money App Store coin sales. Before release, set `BURROW_IAP_ENVIRONMENT=production` and `BURROW_SANDBOX_COIN_MODE=isolated`, disable the legacy tester allowlist and redeploy. Verify actual products and production notifications; plan a separate sandbox-capable test API for continued development/TestFlight/App Review. Leaving automatic `room` mode on with a production receipt configuration fails closed before checkout.

Home accounts with any sandbox coin transaction are test accounts, even after a refund, and cannot receive a new production coin order. Accounts with production coin transactions cannot receive new spendable sandbox orders. Readiness checks refuse checkout before the native payment sheet; the service-only settlement RPC independently enforces the same rule under account/receipt locks. Refunds and retries of existing orders retain the original wallet. Use clean, separate live accounts and segregate test data before public release; no automatic conversion of test coins into paid coins is performed. This guard covers coin purchase settlement, not all other app features or partner sharing. A shared test database does not by itself satisfy a complete production/security/compliance review.

Production purchase/refund logic retains its implementation behind service-only wrappers. Isolated sandbox credentials use their own table; Home test transactions keep their real `sandbox` environment in the environment-keyed Home transaction table. Account deletion clears balances while keeping receipt ownership tombstones.

## Verification

`PGLITE_MODULE=<installed @electric-sql/pglite path> node --test tools/test-coin-environment-database.cjs tools/test-coin-prospective-database.cjs tools/test-coin-sandbox-database.cjs tools/test-burrow-coins.cjs tools/test-coin-shop-ui.cjs tools/test-coin-prices.cjs tools/test-burrow-reliability.cjs`

Migration deployment: `bash tools/push-coin-sandbox.sh --dry-run 20261009000211`, then `--apply 20261009000211`. The script supports only 207/208/209/211 and applies the explicitly selected version, never pending Surprise migration 206 or old manually-applied migrations. Historical suites preserve their original behavior; the environment suite applies through 211 and checks automatic admission, environment conflicts, duplicate/refund behavior, service-only privileges, and no backfill. Advisory lock ordering is inspected; these single-connection tests are not a live concurrent-transaction load test.

Real-device verification still requires the user to complete Apple sandbox checkout, verify the displayed test balance, and buy the same pack again. Never create fake signed receipts or claim a simulated purchase proves Apple's end-to-end flow.

## Price loading

`coin-store-prices.ts` queries StoreKit/Play products immediately after the global IAP connection initializes, in parallel with receipt recovery and without an authenticated API preflight. Startup/shop/retry share one in-flight price request. Only official localized `displayPrice` strings are persisted to the registered device-scoped MMKV key `burrow_coin_store_prices_v1`; balances, login state, and server readiness are not cached there.

The shop paints stored prices synchronously and silently refreshes after a 5-minute freshness window. Prices older than 7 days, malformed data, a different platform, or a detected storefront change are discarded. Actual checkout still checks server readiness and the system sheet shows the authoritative current charge. A brand-new installation or a changed storefront still needs its first real store response; immediate prices cannot be guaranteed before that response, especially offline. No hardcoded USD fallback is presented as an official store price.

## Deployment record — 2026-10-09

- Migration `20261009000207` applied to linked project `qleeohkhbrdvznbwgqad`. Only this migration was executed. Sandbox/production coin transaction counts were both zero before applying it; no existing wallet balances were changed.
- Database checks confirmed the wrapper is service-only, the internal production helper is not service/client callable, and the sandbox tables exist.
- Vercel API deployment `dpl_CZ997yh86aHoGDSg4uhysFw99xc8` is READY at `https://api.soulsayit.com` (deployment URL `https://novame-monorepo-d118c9o73-soulsayit.vercel.app`). Built from commit `1302f06c` plus only this release's coin readiness route change; unrelated uncommitted Surprise changes were excluded. No Git push or native app release was performed.
- 36 targeted mobile/API/PostgreSQL tests pass; API and mobile type checks pass; Vercel production build passes. The older broad Burrow database fixture fails at its 18th assertion (`shared Plus starts a two-hour adventure`) on both unchanged HEAD and the working tree; it is a pre-existing fixture mismatch, not reported as passing.
- Reload Metro to pick up the test-balance messaging, then use Retry store if necessary. The real Apple product query and sandbox checkout still require device testing.

### Follow-up — price preloading and Home-wallet tester mode

- Read-only verification found one verified 200-coin sandbox purchase in the isolated wallet. Its payment had succeeded; Home not increasing was the intended isolation from 207, not an unverified receipt.
- Migration `20261009000208` applied remotely. Post-deployment database checks confirm zero enrolled testers and the existing 200 isolated coins unchanged. Account enrollment/backfill is pending the user's confirmation of their App account (not their Apple Sandbox login).
- API deployment `dpl_6Bceprzug9HwMazRVHNj5EDAAM8S` is READY at `https://api.soulsayit.com`, built from `1302f06c` plus only the coin readiness route. Other uncommitted API/Surprise changes remain excluded.
- 45 targeted coin tests pass; mobile/API type checks pass. Mobile price-preloading and approved-tester balance refresh require a full Metro Reload; no new native dependency or rebuild is required.

### Follow-up — new purchases only and background recovery

- Read-only inspection found two verified 200-coin purchases belonging to the same App account, which was not enrolled. Both were credited to the isolated sandbox wallet (400 total), explaining why Home remained zero.
- Migration `20261009000209` was dry-run and applied alone. That uniquely verified testing account was enrolled prospectively; the enrollment returned `delta: 0` and Home balance 0. No historic receipt was backfilled. Other users remain isolated.
- Post-enrollment read-only database verification confirmed `testerEnabled: true`, Home balance 0, isolated balance 400, and exactly two isolated receipts unchanged.
- API deployment `dpl_2jUy5ZwFNkJpXARsb9u3At4uuXSs` is READY at `https://api.soulsayit.com` (deployment URL `https://novame-monorepo-9n5k2sq35-soulsayit.vercel.app`). Built from `1302f06c` plus only the coin verification/readiness route. Unrelated pending API/Surprise code and migration 206 were excluded.
- Resume audit: mobile `getSession()` errors were ignored, allowing a failed token refresh to become an unauthenticated HTTP request. Supabase already refreshes expiring sessions inside `getSession`; no redundant refresh is needed. One production bootstrap 401 was observed in the investigation window, but server logs alone do not prove the precise device-side cause.
- Cached silent bootstrap failures were published in the same `error` field as failed user actions, causing the generic “That didn’t finish” UI. The 30-second cache check then skipped retries despite the error, and pre-background requests had no cancellation/generation boundary.
- Mobile recovery now rejects failed auth token resolution, separates `syncError` from visible action errors, retains cached Home during silent transient failures, retries failed foreground reads with bounded backoff, and forces a fresh read on real background-to-active transitions. Old read successes/failures cannot replace resumed state. Snapshot reads are aborted on background/account/pair changes; durable commands and purchase settlement are not. StoreKit/Face ID `inactive` transitions do not cancel reads.
- 157 targeted tests pass across coin pricing/UI/API, historical and prospective PostgreSQL settlement, reward reconciliation, Home lifecycle/cache/realtime, and personalization. Mobile/API type checks and `git diff --check` pass. These automated checks do not substitute for an actual new Apple sandbox checkout.
- Full Metro Reload is required for these JavaScript changes. No native dependency/rebuild is required. Real-device checkout and repeated background/resume remain the final end-to-end checks.

### Follow-up — changed App identity (2026-10-09)

- The next verified 200-coin receipt was signed at `2026-10-09T09:37:56.369Z` for a **different App UUID**, not the previously enrolled tester. It credited the isolated sandbox wallet correctly; Home remained 0. This was not a missing migration or lost StoreKit receipt. The Apple sandbox login and the App account UUID are different identities.
- The uniquely identified new testing account was enrolled prospectively at `2026-10-09T09:48:04.297911Z`. Enrollment returned `delta: 0`; read-only verification confirmed enabled tester status, Home 0 and the existing isolated 200 unchanged. No old order was backfilled or reassigned. A genuinely new receipt signed after activation can now credit Home for this account. Reinstalling/signing out into a new anonymous App identity does not inherit the tester allowlist; confirm readiness before another checkout.
- Migrations 209 (coin settlement) and 210 (free Lofi / Plus Lullaby and Jazz) are confirmed applied remotely. Only reviewed music migration 210 was pushed in this follow-up; pending unrelated migration 206 was not included. The existing deployed verification/command API already calls these RPCs, so no additional Vercel API deployment was necessary.
- Music now pauses and mutes before unregistering/releasing its native player. Cleanup operations are independent; None remains locally muted if its network write fails. Live mute/audio-focus checks prevent stale AppState callbacks from restarting it before React rerenders. The picker has no coin-purchase action, and the server checks reciprocal shared Plus without inventory ownership.
- SVG gradient offsets with leading decimals were normalized (`.45` → `0.45`); an AST regression scan rejects these malformed string attributes. Mobile type-check, targeted music/asset tests, 115 reliability tests and 41 coin tests pass. Real-device audio and a new Apple sandbox checkout are still required; automated tests do not prove a completed native checkout.
- Restart Metro with its cache cleared and **kill/reopen the installed App once** for testing: native players orphaned by the old implementation can survive Fast Refresh. Do not reinstall or change the App account just to reload JavaScript.
- iOS Metro/Hermes export succeeds at `/private/tmp/novame-music-fix-bundle.INAScB` (4,133 modules, 1,029 assets including all three bundled MP3s). This is a bundle-resolution check, not a signed native release or proof of audible playback on a physical device.

### Follow-up — automatic test accounts (2026-10-09)

- User confirmed a new purchase on the enrolled account successfully increased coins. To support continued testing after App identity changes, migration `20261009000211` was dry-run and applied alone. Its immutable prospective activation cutoff is `2026-10-09T10:28:53.348961Z`.
- Remote read-only checks confirm the migration is recorded, clients cannot execute settlement, the service role cannot bypass the internal wrapper, and the three historic isolated receipts remain in their original table. No enrollment, retroactive grant, or synthetic remote purchase was performed in this follow-up.
- `BURROW_SANDBOX_COIN_MODE=room` is configured for the current sandbox API. Newly verified sandbox transactions can credit Home for fresh accounts without registering their UUID. Account identity binding still applies to each receipt; an old account's purchases/balance are not transferred to a replacement identity.
- API deployment `dpl_Ge1CtQH7JtRV1pofQAydv5kkGPmw` is READY at `https://api.soulsayit.com` (deployment URL `https://novame-monorepo-reeuw4v6u-soulsayit.vercel.app`). Built from `1302f06c` with only the coin verification route and coin verification library overlaid. Pending Surprise changes/migration 206 were excluded. No Git push or native app release was performed.
- 38 coin verification/environment/prospective PostgreSQL tests and 39 coin UI/prices/Home reliability tests pass. Real-device checkout on a fresh App identity is still required to confirm the complete StoreKit flow; no automated test or deployment result substitutes for that purchase.
- Reload Metro for the new environment-conflict checkout messages. The automatic test admission is server-side and does not require a new native dependency. Before live release, apply the release boundary above rather than relabeling test funds as paid production coins.
