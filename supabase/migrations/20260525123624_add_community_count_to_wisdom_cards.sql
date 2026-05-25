-- Add community_count column to wisdom_cards
--
-- Stores the server-rolled "people resonated" number (30-999) generated
-- at publish time. Each wisdom card persists its own number so My Logs
-- re-opens show a stable, identical value to what the user saw the
-- first time on the Insight screen.
--
-- Nullable on purpose: historical wisdom_cards rows (pre-migration)
-- have no value to backfill — the random number was never persisted in
-- the old flow, so it cannot be recovered. Mobile InsightView treats
-- NULL as "hide the community-count row" for those historical cards.
-- New cards (post-deploy) always have a value.
--
-- Range constraint matches the server-side rollCommunityCount() formula
-- in apps/api/src/app/api/publish-wisdom/route.js: 30 + floor(random * 970).

ALTER TABLE "public"."wisdom_cards"
  ADD COLUMN IF NOT EXISTS "community_count" integer
  CHECK ("community_count" IS NULL OR ("community_count" >= 30 AND "community_count" <= 999));
