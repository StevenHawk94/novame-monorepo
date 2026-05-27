-- Add peer_comment column to wisdom_cards
--
-- Stage 6 follow-up: new InsightView block "Truth-Telling Peer Comment"
-- (renders between Block 3 "Your Inner Profile" and Block 4 "3-part Reframe").
--
-- The new Section C of the AI prompt generates a 500-700 char
-- Reddit-style peer comment authentic to one of 7 emotional-state
-- branches plus a Conflict Emotion branch. The text is persisted
-- per-wisdom so My Logs > Insight rerenders the same peer comment
-- the user saw at publish time.
--
-- Nullable -- historical wisdoms predate this column. InsightView
-- gates the new block on (peer_comment != null && length > 0), so
-- old rows simply hide the block (matches the same null-gating
-- pattern as community_count from migration 20260525123624).
--
-- No CHECK constraint on length: 500-700 char range is enforced
-- by the AI prompt at generation time. Server-side validation
-- would just add a failure mode without improving UX -- if the
-- AI returns slightly over/under, the UI handles it gracefully.

ALTER TABLE "public"."wisdom_cards"
  ADD COLUMN IF NOT EXISTS "peer_comment" text;
