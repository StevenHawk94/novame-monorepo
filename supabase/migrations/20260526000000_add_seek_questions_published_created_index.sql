-- Add partial index for /api/seek-questions list query pagination
--
-- Stage 6 follow-up (Discover infinite-scroll). The Discover tab feed
-- runs:
--   SELECT * FROM seek_questions
--   WHERE is_published = true
--   ORDER BY created_at DESC
--   LIMIT N OFFSET M
--
-- Previously this scanned the whole table on every page; with
-- pagination shipped (apps/api/src/app/api/seek-questions/route.js),
-- the same query runs once per scroll batch. A partial index keyed
-- on (created_at DESC) WHERE is_published = true gives the planner
-- an O(log n) lookup + sequential index scan instead of full table
-- scan + sort.
--
-- Partial-index choice: ~80%+ of seek_questions rows are
-- is_published=true (the rest are user-submitted drafts not yet
-- approved by admin). The partial index is slightly smaller than a
-- full index and avoids indexing rows the public feed never reads.
--
-- DESC ordering matches the query's ORDER BY direction (avoids
-- backward index scan).

CREATE INDEX IF NOT EXISTS "idx_seek_questions_published_created"
  ON "public"."seek_questions" USING "btree" ("created_at" DESC)
  WHERE ("is_published" = true);
