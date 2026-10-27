# Surprise Room

## Preview, checkout and playback polish — 2026-10-17 (client only)

- The local-file delay was native image decoding: quick/recorded rain still
  mounted 18 separate SVG photo masks, unlike the previously precomposed inbox
  path. Both previews now precompose and decode a single 512px bitmap before
  presentation; every particle shares the full portrait. Cached previews check
  the native decode cache again before opening. Default-face geometry and
  uploaded-photo crop rules are unchanged. Retired history frames stay
  photo-only, with no mapping to a current frame.
- The frame picker still offers a three-second silent demo. Recorded previews
  play their complete 1–60-second audio and close back to checkout only at EOF
  or an explicit close. Background/navigation invalidates pending autoplay.
- Receive now leases the same already-loaded native player used by preparation,
  rather than disposing the validation player and decoding again in the route.
  At zero it skips a redundant seek. Three idle players are retained, prioritizing
  unopened recipient messages; active leases survive cache eviction until their
  view unsubscribes, and account/pair invalidation immediately pauses them.
- Back from an unsubmitted photo/voice draft asks whether to discard. No keeps
  editing; Yes removes draft/derived preview files and returns to frame selection.
  Android hardware Back uses the same handler. Approved, unconfirmed sends keep
  their immutable outbox key/files and cannot be discarded as an unpaid draft.
- Oops/Coin Shop is the existing shared route over the retained checkout. A
  top-up never sends automatically: the next tap still needs purchase approval.
  A definitive server-side insufficient-balance rejection returns editable media
  to checkout and Oops; unknown receipts never get a new potentially-paid key.
- Only a committed receipt shows the Surprise sent success dialog. Its underlay
  is already a fresh frame picker; Done does not leave a stale Sent page. Old
  confirmed drafts likewise reopen at frame selection. No API, transaction,
  Admin-price or database migration changes are required.
- iOS native acceptance used the isolated `com.novame.localuiqa`, real Skia/
  image decoding and an artificial eight-second AAC. Inspected complete quick
  portraits, recorded playback, prepared Receive/replay, discard No/Yes, common
  Oops, a simulated top-up returning to checkout, explicit purchase confirmation,
  a simulated committed receipt and Done returning to frame choices. Auth, inbox,
  outbox and store payment were isolated; no real message or payment was made.
  The heavily loaded host did not permit a reliable millisecond latency claim.
  The QA app/server were stopped and its originally-off simulator shut down.
- Whole-repository regression: **1,666 passed, zero failures**. Focused
  preview/playback/checkout coverage: **82 passed**. Regression evidence:
  `/private/tmp/novame-surprise-smooth-full-final.log`,
  `/private/tmp/novame-surprise-smooth-targeted.log`,
  `/private/tmp/novame-surprise-smooth-types-final.log`, and
  `/private/tmp/novame-surprise-smooth-bundles-final.log`. Android emulator remains
  skipped; mobile binary/OTA distribution is separate.
- Frozen-source TypeScript and both production JS bundles passed. Final bundle
  output is `novame-mobile-bundles-TechU4` (Android 1,306 assets, iOS 1,303).
  Both were checked to contain the final photo-only history fallback; no QA
  entry, generated test audio or synthetic account state is shipped.

## Delivery/readiness repair — 2026-10-17 (local implementation)

- Current choices are the 36 supplied local frames. Admin owns per-send prices and Plus flags; the server continues to validate them and atomically publishes/charges exactly once per immutable send key.
- Startup begins recipient metadata/media preparation as soon as the current pairing is verified, including while Home's entry cover is visible. **5 seconds is a soft preload window, not another Home dependency**: it neither keeps the launch cover open nor cancels downloads. Ready messages may present immediately on Home; late messages wait until Home is active and other overlays have closed.
- The Receive card requires complete local photo/audio, successful native audio inspection and decoded artwork. It never downloads after the tap in the ordinary flow. The prompt uses the existing full-window overlay instead of racing a native modal dismissal against a stack presentation. Prefetching does not mark a message opened; actual audio playback does.
- A user-confirmed send is persisted to an account/pair-scoped outbox before the screen acknowledges it. The user can leave or make another surprise while a native background file-body upload executes the existing authenticated send transaction. **Queued is not Sent**; only a server receipt shows success. An explicit 4xx rejection stays visible with its reason; uncertain failures recover the original receipt before retrying the same media/key. OS termination is not an always-running JS guarantee: pending jobs recover on next foreground/restart.
- Sender originals are copied into the replay archive without re-downloading. New drafts never delete files owned by queued jobs. Confirmed upload spool files are reclaimed, including after restart; originals are retained if archive copying fails.
- Replay media is in an app-private document directory with a 128 MiB access-based budget, whole-message eviction and active-playback pins. Existing temporary files migrate lazily. Cached history metadata has no age-expiry blanking. Missing/corrupt media is repaired through the authorized download path; signed URLs are never persisted. Account/pair changes invalidate pending callbacks and clear private media for the former scope. Offline clients cannot provide instantaneous remote revocation of files already downloaded.
- History opens playback directly, seeks the current player to zero on every restart, and resets a single animation session. Pause/resume is distinct from replay. Audio and frame are precomposed to a reusable transparent bitmap before presentation, with the existing native-driver/reduced-motion fallback retained. Closing/backgrounding invalidates pending autoplay.
- Recording uses the stopped file's native duration, not a stale recorder tick. Server container validation remains authoritative (audio-only, bounded duration, bounded bytes); disagreement with an untrusted JS stopwatch no longer rejects an otherwise-valid recording. Diagnostics record only phase/code/reason/timing, never user IDs, URLs or media.
- Migration **20261017000243** adds service-only pairing-scoped receipt recovery and private `surprise_changed` invalidations for committed sends/first opens. It does not change transaction prices, wallet logic, RLS, media ownership, or historical rows. The existing Burrow realtime connection forwards those events; startup/foreground/periodic refresh remains the missed-event fallback.
- Release status: migration 243 and the matching API are deployed; see the production execution record below. Mobile installation/OTA and physical-device animation/camera acceptance are separate and were not published/performed by the API release.

### Local verification / remaining acceptance

- Whole-repository Node regression: **1,625 passed, zero failures**. Final Surprise/camera/pairing subset after the last fixes: **177 passed**. Shared engine: **39 passed**. Mobile/API TypeScript and API production build passed.
- Cases include the five-second soft window and late Home presentation; receipt recovery after restart; consecutive independent sends / duplicate retries; old-account/pair callbacks; camera focus/timeout and crop geometry; local replay at EOF; rapid Replay taps; background cancellation; and History updates without leaving the page. Migration 243 was executed only in the isolated PostgreSQL fixture.
- Final frozen-source iOS/Android production JS bundles both passed (1,303 / 1,306 packaged assets). This is separate from native device acceptance. No real-user surprise was sent, no live coins spent, and no microphone/camera permission was granted during this repair. The existing simulator account/draft was preserved.
- Historical POST 400 entries lacked a rejection reason, so their original cause cannot be proved retroactively. The stopped-file duration path, actionable rejection details and phase-only diagnostics make the next real-device reproduction diagnosable without logging private media.
- Remaining device acceptance: two physical devices testing real front/back cameras, receive after a slow launch, interruption/resume and cached native History playback/animation. Authenticated production API send/receive/replay-media and exactly-once spending have passed the checks below. OS force-quit still requires a later app launch to recover unfinished jobs; do not promise uninterrupted execution after force-quit.

## Production execution — 2026-10-17 UTC (migration 243)

- Applied **only** `20261017000243` to linked project `qleeohkhbrdvznbwgqad`, with an advisory transaction lock, 5-second lock timeout, 30-second statement timeout, and atomic migration-history registration. Exact new function bodies, service-only receipt permissions, enabled notification trigger and existing RLS were verified. The five original financial/send/history function bodies stayed byte-identical.
- API deployment [`dpl_4ZqbBsRmigjdJ82zoxfE7EtXtSxY`](https://vercel.com/soulsayit/novame-monorepo-api/4ZqbBsRmigjdJ82zoxfE7EtXtSxY) is **READY** and serves `api.soulsayit.com`. The API-only workspace snapshot compressed to about 1.4 MB. Downloaded Vercel source archive UID and exact Surprise route/validator SHA-256 hashes matched the tested workspace; it contained no local environment files, native artifacts or other applications. An earlier local archive traversal was stopped before any cloud deployment was created.
- Authenticated production acceptance used two run-tagged disposable accounts, a synthetic 512×512 JPEG and 2-second AAC, and dedicated ledger-backed test credit; no store purchase or real-user balance was used. Three independent messages (two forward, one reverse) cost exactly three 300-coin test debits. Concurrent identical requests returned the same message with one wallet-version increment / one ledger row. Receipt recovery and retries caused no further debit; changed payload and stale relationship were rejected.
- Second-send acceptance deliberately included an inaccurate client stopwatch; the real encoded audio duration was stored correctly. Both users received private invalidations and saw matching Sent/Received history. Sender/recipient media downloads were checked byte-for-byte 14 times, with downloaded AAC actually decoded by FFmpeg. Prefetch and sender acknowledgement did not mark the recipient opened; recipient acknowledgement was idempotent. Replays and repeated acknowledgement left wallet versions, balances and ledger rows unchanged.
- Production Supabase `realtime.send` adds a random transport `id` to otherwise-empty payloads. The initial acceptance script's empty-payload assumption was corrected after inspecting that platform function; only this UUID is allowed by the production test, with no business/user/media payload fields. No application transaction or client logic needed changing.
- All temporary identities from both acceptance attempts, their profiles, wallets, ledgers, surprise rows and test Storage objects were removed; cleanup verified zero remaining scoped rows/objects. Production catalog verification still found exactly the 36 valid Admin-managed frames, matching names/metadata, authenticated routes and `no-store` responses. Isolated SQL regression passed **18 tests**.
- Reproducible tools: `release-surprise-delivery-243.mjs` (`--apply` / `--verify`), `prepare-api-production-release.mjs`, and opt-in `verify-surprise-delivery-production.mjs --fixtures`. The latter exercises only identities tagged with that invocation's UUID and cleans their explicitly manifested media keys, including both directions after profile cascades.
- No Admin deployment, mobile binary, OTA, real camera/microphone capture or native physical-device animation playback was performed by this release.

The sections below describe earlier rollout snapshots; the current behavior above supersedes the older on-demand-download/20-pair-cache notes.

## Product flow

- Burrow map replaces Our Room with Surprise Room, keeping the other seven rooms and their positions. Legacy `section=our_room` links redirect to the new room; existing Home/shared-room furniture and inventory are not deleted.
- Twenty supplied local WebP face frames. Santa/Birthday/Heart identifiers remain compatible; old Bunny/Flower/Star SVGs are used only for historical records/drafts, not new frame choices. Originals are unchanged. Each new frame uses its own measured cutout bounds and SVG mask, including heart-shaped openings.
- Full-screen front/back camera and photo library; captured camera image freezes before editing. Drag/zoom the frozen photo, then confirm a 512-pixel-wide JPEG with the cutout's actual aspect ratio. Camera, crop, portrait and rain share the same geometry. Changing frame requires a newly aligned photo. No Toy daily photo quota is consumed.
- Record voice or singing, 1–60 seconds, mono AAC 64 kbps. Actual container duration and audio-only tracks are validated on the server. Preview, retake and re-record cost nothing.
- Send costs exactly **300 carrots**, server-owned pricing. The upload ticket binds sender, recipient, pairing generation, frame, audio duration, photo/audio digest and idempotency UUID. Both immutable private media files must exist before the database transaction charges and publishes the message.
- An uncertain send locks its original media/key for a safe retry. Draft files and metadata survive app restart. Confirmed sent drafts reopen as Sent rather than another paid send. Replaced draft files are removed; account switch clears private draft/cache files.
- Metadata refreshes silently on launch, foreground and every 60 foreground seconds. The Receive prompt waits for Home, launch cover and other overlays; dismissing leaves the message available in history. Only a visible arrival card requests its signed face thumbnail, never its voice. Voice download/playback starts after Receive.
- Local Preview Surprise lasts exactly three seconds, independent of recording duration. The inline preview uses 12 static particles. Receive presents a transparent native-stack modal over dimmed Home; 28 fixed, native-driver particles reuse the local photo while the recording plays, with rasterized layers and memoization to avoid audio-status rerenders. Pause, close, finish, background and sign-out stop playback. Reduced Motion uses a static portrait. Audio focus suspends Home's ambient soundtrack.
- Top-right History has Received / Sent tabs and cursor-based pagination (20 metadata rows per page). Selecting a record loads media and enables free replay. Old tab/account responses are discarded. The arrival inbox remains independently bounded to the latest 100 metadata rows.
- Replay reauthorizes access and renews signed links. Cache holds at most about 20 media pairs; server messages remain in history. Unpair/re-pair changes relationship generation and denies new authorization for old messages, even for the same two accounts. Already-issued bearer signed URLs can remain valid for their remaining five-minute lifetime; this is not instant cryptographic revocation.
- Hourly authenticated cleanup expires unpaid upload tickets after seven days, keeping tombstones against late retries; removes private orphan files, never paid message media. Account-deleted orphan files also qualify after one day.

## Rollout

1. Apply **only** `20261008000204_burrow_surprise_room.sql` after the existing Burrow migrations, then reload PostgREST schema. Do not blindly reapply older manually-applied migrations.
2. Deploy API including `/api/vnext/surprise` and `/api/cron/surprise-cleanup`; existing `CRON_SECRET` protects the cleanup endpoint. Storage bucket `burrow-surprises` stays private with no client write/read policies; all access is through authenticated API + service-only RPCs.
3. Ship mobile changes. `expo-audio` / `expo-camera` are existing dependencies. Microphone permission copy changed in app.json; native permission copy updates on the next native build.

## Frames/history update — prepared, not deployed (2026-10-09 UTC)

- After existing migration 205, apply `20261009000206_burrow_surprise_frames_history.sql` to expand supported frame IDs without rewriting old messages, preserve the existing 300-carrot/idempotent transaction, and add service-only paginated history plus indexes.
- Deploy `/api/vnext/surprise` with history and face-only signed-link support, and the bounded rectangular Surprise-photo decoder. Room-frame and Toy photo ratios remain unchanged.
- Then deliver the mobile client. No new native dependency is required. No production migration, Vercel deployment, OTA or native package was executed in this update.
- Verification: 33 API/mobile/history/rain tests, 13 actual SQL tests in isolated PGlite, 100 existing reliability tests; mobile/API TypeScript checks and API production build. The portrait component was rendered with all 20 supplied frames and a synthetic crop-check face, then visually inspected. No active iOS simulator was available; real camera/microphone, two-account receive and low-end-device frame rates still need native end-to-end QA.

## Cost/privacy evaluation (not policy changes)

1. Current implementation records mono AAC at 64 kbps, at most 60 seconds. For short spoken messages, 32 kbps / 30 seconds is approximately 120 KB of encoded audio before container overhead. This is a sensible future option, but singing quality should be checked before halving bitrate. Old 60-second recordings must remain replayable after any future creation limit change.
2. Audio is currently in **private Supabase Storage**, not R2. DB rows already contain keys/paths, never audio blobs; signed URLs expire after five minutes. R2 Standard would be a reasonable later migration if storage/egress bills justify it; not a requirement for the new local frames or animation.
3. R2 charges storage and operations but no internet egress. Its current Standard price is $0.015/GB-month; IA is $0.01/GB-month but has higher request costs, retrieval charges, no Standard free allowance and a 30-day minimum storage duration. For tiny recordings, do not assume IA is cheaper: lifecycle transitions/read volume can outweigh storage savings. Start with Standard and measure usage. R2 IA is not a Glacier-style archival tier. Sources: [pricing](https://developers.cloudflare.com/r2/pricing/), [classes](https://developers.cloudflare.com/r2/buckets/storage-classes/).
4. Do not retroactively delete or paywall replay of surprises that already cost 300 carrots. A recent-five UI limit is distinct from physical retention/deletion. Any future Plus history policy needs explicit product approval, advance disclosure, entitlement checks and restoration behavior; no restriction was introduced here.
5. Account deletion currently cascade-deletes metadata; private orphan files are collected later (eligible after one day). This is **not synchronous media deletion**. Prioritize a durable deletion workflow for both face and audio, pending uploads and cached/downloaded files, with retry/audit and no false success. No live media was deleted in this update.
6. Storage encryption at rest/in transit is not end-to-end encryption; authorization, short-lived links, log redaction and user-facing retention/deletion disclosures remain necessary. R2's documented encryption does not on its own establish legal compliance or E2EE: [data security](https://developers.cloudflare.com/r2/reference/data-security/).

## Production execution — 2026-10-08

- Applied only `20261008000204` to linked Supabase project `qleeohkhbrdvznbwgqad`, with the migration-history insert in the same explicit transaction, guarded against replay and bounded by lock/statement deadlines. Recent prerequisite migrations through `20261008000203` were already recorded; old historical differences were not replayed.
- Verified the private `burrow-surprises` bucket, its MIME/size limits, enabled table RLS, no anonymous/authenticated table access, and all four service-only RPCs. The message table remained empty; no live carrots were spent or partner messages sent during verification.
- API production deployment `dpl_DLfcVNiZyqSzpRZiRZQNmNx7j2UA` is **READY**, with `api.soulsayit.com` pointing to it. Cloud build includes `/api/vnext/surprise` and `/api/cron/surprise-cleanup`.
- Verified the deployment's hourly Surprise cleanup schedule (`25 * * * *`) and the existing production `CRON_SECRET` configuration. Unauthenticated requests to both new routes and the existing bootstrap route returned 401 on the production domain.
- Re-ran all 13 Surprise API/mobile tests and 10 isolated database tests successfully before deployment. No authenticated two-account send was performed against production.
- No native app package or OTA update was published. Installed release builds still need the updated mobile client; Vercel deployment updates only the backend.

## Verification

- `pnpm test:surprise` — API input/auth/upload order/retry/signing; mobile creation, permission denial, retry identity, receipt playback acknowledgement/background and restart state.
- `PGLITE_MODULE=<installed @electric-sql/pglite path> pnpm test:surprise:db` — actual migration + wallet function: atomic 300 spend, duplicates, missing media, stale pairing, private replay, RLS/RPC privileges and cleanup.
- Mobile TypeScript, API production build, existing reliability regressions and Burrow map tests.
- Real AAC fixture generated with FFmpeg is accepted by the container parser.
- Simulator launches the installed Burrow app, but its session is at unauthenticated onboarding. Authenticated native creation, two-account receive/playback and real-device camera/microphone still need end-to-end testing after migration/API rollout. The iOS simulator does not substitute for real camera testing.
