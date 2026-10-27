# Immediate Adventure arrival

The server still selects the outcomes, enforces `ends_at`, validates answers,
and grants unique inventory receipts. The phone only projects the display.

## Data and display flow

- Migration **240** adds service-only `adventure_display_v1`. Under the existing
  pair/inventory/adventure locks it returns the current user's journey, actual
  result (if any), and a versioned preselected display plan. Reading a plan
  never creates a result, grants inventory or records a discovery.
- V3 start responses attach this display. The durable journal start receipt
  stores it before acknowledging it locally. Bootstrap also restores it during
  the countdown; a lightweight authenticated `/api/vnext/adventure` retries a
  missing plan without reloading the whole catalogue.
- The foreground arrival timer publishes `result_ready` with the cached plan
  at the exact server-adjusted deadline. Home and Adventure subscribe to that
  same snapshot. Background settlement/full reconciliation do not gate paint.
- Snapshot reconciliation preserves same-journey arrival and the newest plan
  `readAt`; a changed dialogue hash warms its new assets. Real server receipts
  supersede previews. Cancellation, completion, a new journey or a new pairing
  cannot resurrect an earlier preview. Replayed start receipts cannot reset the
  countdown anchor.
- Completion backgrounds, both chest states, furniture, friend gift and both
  character poses warm during the countdown via the existing platform caches.
- An immediate claim may beat background settlement: migration 240 wraps the
  existing dispatcher to settle due planned journeys in the **same transaction**
  before treasure/respond/claim. Existing locks, stage checks and unique item
  receipts remain in force, including on retries and two-device races.

## Rollout

Apply `20261015000240_adventure_arrival_display.sql`, then deploy API and ship the
mobile update. An API deployed before the migration tolerates only the missing
display RPC; it does not invent a plan. This compatibility fallback still uses
the old network-gated arrival until the migration is installed.

## Verification

- `node --test tools/test-adventure-arrival.cjs tools/test-adventure-display-api.cjs tools/test-adventure-bootstrap.mjs tools/test-adventure-instant-flow.cjs tools/test-adventure-background-prefetch.cjs tools/test-burrow-performance.cjs tools/test-adventure-delivery.cjs`
- `BURROW_PGLITE_PATH=/path/to/pglite/dist/index.js node tools/test-adventure-encounters.mjs`
- `pnpm --filter @novame/mobile type-check`
- `node tools/verify-mobile-bundles.cjs`

Device checks after rollout: stay on Home through expiry then immediately open
Adventure; stay on the ongoing screen through expiry; background/restart before
expiry and return after it; open/claim/answer quickly while settlement is slow;
repeat receipts, change pairing and repeat on the other platform. No visual
transition should wait for a bootstrap, and inventory must be granted once.
