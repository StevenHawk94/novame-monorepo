# Adventure / Admin cleanup — 2026-10-08

## Implemented locally

- Removed Admin Analysis, Orders, old Pricing, Outfits, Memory Items, Connection Insight and Bunny Court, plus their exclusive management endpoints/components. Kept Shop Pricing, Burrow Content, users, announcements, marketing and overview.
- Removed the old mobile Bunny Court and Insights screen implementations. Existing routes redirect Home, so stale links do not crash. Removed the exclusive mobile Court API adapter.
- Write Freely now opens a plain 5,000-character journal, with account-scoped local draft recovery. No prompt picker or client icon matching.
- Modern record preparation skips text matching/dictionary loading for Write Freely, and skips Memory AI/allowance claims for both Adventure record modes. Existing shared-memory/legacy API compatibility remains server-side.
- Both Save flows automatically finalize the durable receipt and show the new ready screen. Explicit finalization retries reuse that receipt; duplicate taps, late responses and account changes are guarded. The existing settlement outbox still recovers interrupted saves.
- Tap choices/note/sharing and the request key persist locally. Selection catalogue now uses the approved local-only v4 vocabulary.
- Adventure ready screen uses the existing shovel-bunny art. Waiting screen uses digging art, actual adventure ordinal, server-clock progress/countdown and a treasure target. Removed narrative logs; retained Open on completion and Back to Home. One-minute test duration unchanged.

## Approved icon classification — implemented locally

See [icon classification](tap-your-day-icon-review.md) and the machine-readable `tap-your-day-icon-proposal.json`.

- 118 defaults + 69 optional choices. Five people are selection-only IDs; 182 IDs are from the original base dictionary.
- Packaged all 50 missing WebPs from existing local source files (604 KiB additional art). The shared allowlist is `packages/engine/src/items/tap-your-day-local.json`.
- Replaced full-catalogue Add/matching with curated optional activities. Search only filters approved labels. All selection/preview art is bundled and ignores R2 overlays; approved IDs are excluded from legacy remote staging/prewarm too.
- v4 server validation uses the same local allowlist before remote dictionary access. v1/v2 vocabularies and v3 custom validation remain frozen for installed clients and historical records.
- Optional additions persist per account under a new v4 key. Approved legacy IDs import with canonical activity names; excluded preferences remain untouched under the old key and do not appear in new selection.
- No icon assets, R2 objects, old records or database tables were deleted. Excluded means unavailable for NEW selection, not broken historical references.

## Deliberately retained

- Modern Shop outfit/decor purchases, local art and new Shop Pricing.
- Coins, native IAP, subscriptions and payment/order history infrastructure.
- Memories Room, photo caching/cleanup, Rage Room, friends/pairing and historical records.
- Shared server libraries and compatibility data used by old API callers or history. Removing those requires a separate reference-by-reference retirement, not deleting them with the Admin tabs.

## Release

This change does not add a database migration. Nothing was deployed or deleted from cloud storage. API changes must be deployed with the mobile update; until then the old deployed prepare endpoint can still perform legacy matching/AI.

## Local validation

- `pnpm test:tap-your-day`: 77 passing tests (classification, offline API validation, optional picker, account isolation, legacy vocabulary/art and settlement compatibility).
- `pnpm test:reliability`: 91 passing tests.
- Engine Vitest suite: 197 passing tests.
- Mobile/engine TypeScript checks and API production build passed.
- iOS and Android production exports passed. Verified the actual exported asset hashes contain all 187 approved images on both platforms. This is packaging validation, not a claim of simulator or physical-device visual acceptance.
