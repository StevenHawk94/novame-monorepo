# App domain isolation — execution and acceptance

Scope: preserve optimistic UI, durable retries, notification readiness and the
2026-10-23 navigation performance baseline. No store release or force-update
publication is implicit in this work.

## Product invariants

- Each account owns its own room, wallet and inventory. Pairing grants scoped
  reads and explicit social actions, never another room's decoration writes.
- Public immutable catalogue/artwork may be shared; selection, private media,
  pending commands and ownership may not be inferred from another account.
- A durable local acceptance is distinct from server commitment and delivery
  readiness. A rendering/observer error cannot reverse a committed transaction.
- Identity is checked before token resolution, before dispatch and before
  consuming a response. Relationship-scoped work additionally checks its epoch.
- Every persistent key has an explicit lifecycle registration.
- Background work never mounts unrelated screens or restores broad wallet
  subscriptions to the optimized Affection/Adventure routes.

## Work packages

- [x] Regression counterexamples: native masking, personal room read/write,
  purchase lifecycle, observer failure and token-acquisition race.
- [x] Safe SVG/photo surface: no ForeignObject/native-view snapshots; preserve
  the existing alpha-derived geometry, media cache and bounded retry behavior.
- [x] Shared infrastructure: scoped transport, registered purchase journal,
  receipt/application separation and observer isolation.
- [x] Room ownership: personal projections and atomic owner-only DB writers;
  gift replacement and toy selection use the same room service.
- [x] Unified Plushie purchase orchestration and minimal page subscriptions.
- [x] Versioned migration: archive legacy rows; prefer known personal choices,
  otherwise only personally entitled choices; no invented ownership or charges.
- [x] Executable architectural checks: storage keys, unsafe native primitives,
  public feature interfaces and critical contract regressions.
- [x] Current contract regressions (419), isolated database assertions (39),
  type checking, iOS/Android production bundles and native cross-feature visibility.
- [x] Native manual acceptance: actual Plushie/Collection/Shop routes, camera
  placeholder, Affection six cards, Music three tracks, Game initial categories
  and Surprise first/subsequent frame rows remain visible after Plushie use.
  Real corrupt private image bytes are rejected by the native metadata loader
  and removed from the shared cache, without relying on an SVG error callback.
- [x] Native navigation sampling and same-environment no-mask control completed.
  User revised acceptance on 2026-10-24: reference 30–50fps and no perceptible
  blocking, not strict parity with yesterday. Two runs average roughly 46fps;
  slow frames remain. No zero-dropped-frame claim.
- [ ] Physical-device Release acceptance, including Android native validation.
- [x] Authorized production migration 267 and API deployment, source/hash/readback
  verified. Admin unchanged because this scope requires no Admin implementation.

## Release gates

Verify both purchase entrances, owned/pending/rejected items, photo/camera/crop,
gift claim/replace, A/B personal rooms, third-party denial, reconnect/unpair,
sign-out/restart, duplicate/late receipts, disk/transport/observer failures,
Home/Game/Surprise/Music/Adventure/Collection navigation and ready notifications.
Use real selectors and database functions in integration tests, not mocked
ownership. Native screenshots must validate visibility, not merely focus events.
Record measured frame/entry distributions and limitations; never claim universal
zero dropped frames or exhaustive coverage of all devices.

Production approval received: safe historical restoration policy and verified
API/Admin/database rollout. No announcement/mandatory update/App Store release.

## Evidence and remaining acceptance

See `tools/reports/domain-isolation-2026-10-24.json` for exact logs, export hashes,
native samples, deployment identity and limitations. The current gate is green;
the full historical/retired-feature suite is not claimed green. The client source
has not been published to the stores. Only capable clients activate personal-v2;
legacy installed clients retain their old protocol until updated. Production
wallet, inventory, order, photo, announcement and force-update rows were verified
unchanged during migration. Archived legacy layouts remain recoverable.
