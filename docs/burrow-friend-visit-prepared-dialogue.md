# Friends’ Room prepared dialogue (migration 244)

## Presentation

Friends’ Room v2 uses `AdventureEncounterLayout`, `AdventureStageTransition`
and `AdventureReveal`. The character/panel geometry is identical to Adventure:
15% bottom overlap, alpha-bound artwork anchors, fixed panel position, internal
scrolling on small screens. Scene and opening lines advance individually, then
the question and choices, then individual replies, then the coin summary/Done.
The legacy installed-client flow remains readable and cannot mint old gifts.

## Prepared modes, not network-gated answers

`prepare_friend_visit_v3` returns only the current participant’s authorized
question, choices, per-choice feedback and expected reward. It never awards
coins, starts the expiry clock, or marks the visitor read/completed. It may
create independent and followup display snapshots, each with a stable token.
It does not expose the complete couple reply matrix or the partner’s choice ID.
Per-choice rewards do allow a modified client to infer Trivia correctness;
this is an accepted presentation tradeoff, not authority to mint coins.

Home sync prewarms content and both local character poses/background. A partner
completion invalidates the summary with `partnerCompleted`, so an unopened
candidate can be replaced with followup content. The screen freezes its
candidate on opening. Later refreshes never change that conversation. Both
users can therefore have independent sessions if neither had observed the
other’s answer when opening. Prefetch itself does not count as opening.

The first cold entry stays on the source behind the existing bounded entry
overlay until necessary content/art is ready. Cached entry is synchronous.

## Durable optimistic submission

`friend-visit-local-state.ts` persists the frozen token, cursor, immutable
chosen option, pending submission and Done status before advancing. A choice
immediately displays its prepared feedback and projects its reward using the
existing coin ledger. It also removes the local pending badge. Reading and
Done never await an API or a full bootstrap. Done has a synchronous exit guard.

The worker retries the same token/choice with exponential backoff. Ambiguous
timeouts keep the intent/projection; backgrounding pauses retries, foreground
resumes them, and restart restores without replaying the celebration. Explicit
business rejection rolls back the projected credit and surfaces an error.
Account/pair generation guards reject late old-scope responses. The user-scoped
MMKV key is in the storage manifest; unsent answers are never evicted while old
display caches are bounded. No optimistic credit authorizes a purchase.

`respond_friend_visit_v3` checks ownership and current pairing, installs the
selected frozen mode under the visit lock, then reuses the existing v2 atomic
answer/wallet transaction. Reward calculation uses the server snapshot, never
client amounts. The original visit/user uniqueness and ledger key prevent
double credit even across timeouts, repeated taps, devices, or legacy clients.

## Scheduling

The existing weighted scheduler retains one new visit/day, <=2 appearances of
one friend/week, no consecutive-day repeat, and no question reuse. It now also
requires the immutable `first_seen_at` date to precede the visit date in the
pair schedule’s stored timezone. It does not use the mutable
`interaction_completed_at`, and it is a calendar-day rule, not a 24-hour delay.
Either participant’s prior qualifying discovery still makes a friend eligible.
Migration 244 retires only untouched premature instances; it does not delete
history, completed answers, rewards, or already-started legacy conversations.

## Verification / rollout

- `pnpm test:friend-visits`
- `PGLITE_MODULE=... node --test tools/test-friend-visits-database.cjs`
- `BURROW_PGLITE_PATH=.../dist/index.js node tools/test-friend-visits-integration.mjs`
- Full `tools/test-*.cjs`, mobile/API type checks, production API build, both
  mobile production bundles.
- iOS native visual QA uses the real component with an in-memory offline
  runtime (no production writes), including a deliberately unresolved submission.
  Temporary QA routes must be removed after inspection.

Deploy order: apply migration `20261018000244`, deploy the API, then release the
mobile update. Existing v2 clients keep their redacted begin/respond contract.
Production deployment is a separate, explicitly authorized release step.

### Verification completed 2026-10-16

- Full repository CJS regression: 1,638 passed, 0 failed
  (`/private/tmp/novame-friend-visit-full-final.log`).
- Latest targeted visit/entry/coin tests: 73 passed; latest migration tests:
  9 passed; actual nested Home/bootstrap migration-chain integration passed.
- Engine: 39 passed. Mobile and API TypeScript checks and API production build
  passed. Final production JS bundles passed on Android (4,529 modules) and
  iOS (4,529 modules); no temporary QA route remains.
- iOS SE simulator: inspected the actual native dialogue/layout, sequential
  text, choice feedback and reply-pose transition with an intentionally
  unresolved offline submission. Persistence, background resume, double taps,
  replay/double credit and pair changes were verified by automated tests;
  this is not a production two-account device test. Android simulator skipped.
- Initial implementation verification above preceded production deployment.

### Production release completed 2026-10-16

- Applied exactly `20261018000244_friend_visit_prepared_dialogue` to linked
  project `qleeohkhbrdvznbwgqad`; schema changes and migration history were
  committed atomically. Source/body hashes, RLS and service-only execution
  permissions verified. Existing v2 answer and wallet function bodies unchanged.
  No untouched premature production visits needed retirement (0 before/after).
- API-only snapshot deployed as `dpl_9PHpyaJ5vaiRTWf2RjkFYT2G8hgn`, READY,
  production alias `https://api.soulsayit.com`. No Admin/mobile deployment.
- Release regression: 24 focused tests passed; real migration-chain/nested
  bootstrap integration and local/remote API production builds passed.
- Production acceptance: 12 checks passed through production HTTP and private
  realtime using two disposable paired accounts. Verified first-meeting-day
  exclusion, shared scheduling, stable reward-free preparation, frozen tokens,
  personalized Guess followup, 5/10 rewards, both participants' notifications
  and refreshed Home state, concurrent duplicate retries, conflicting choices,
  actor/reward spoof rejection, foreign sessions, stale/unpaired generation and
  direct RPC authorization. A second published question was seeded only within
  the owned test pair to exercise followup without changing global scheduling.
- Exact reward deltas: account A +15, B +20 across two visits, one ledger row
  per visit/person. Both collections unlocked. All test accounts and their
  owned database fixtures were removed and absence verified; no real-user data
  or global content/prices were modified. This is API/realtime acceptance, not
  an additional native device UI run.
- Reusable tools: `tools/release-friend-visit-244.mjs` (read-only preflight by
  default, `--apply` / `--verify`) and
  `tools/verify-friend-visit-production.mjs --fixtures` (owned fixtures only).
  Local evidence: `/private/tmp/novame-migration244-applied.json`,
  `/private/tmp/novame-244-api-release.json`,
  `/private/tmp/novame-friend244-production.json`,
  `/private/tmp/novame-244-release-tests.log`,
  `/private/tmp/novame-244-integration.log`.
