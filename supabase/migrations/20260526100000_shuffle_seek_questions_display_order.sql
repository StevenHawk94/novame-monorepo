-- Shuffle seek_questions display order (one-time randomization)
--
-- Stage 6 follow-up. Discover tab feed was previously ordered by
-- created_at DESC, which surfaced submission chronology (older
-- questions sink to the bottom no matter how interesting they are).
-- This migration:
--
--   1. Adds a display_order INTEGER column to seek_questions.
--   2. One-time shuffles all currently published rows: each gets a
--      unique sequential number 1..N from ORDER BY random(), so the
--      Discover feed sees a fresh randomized order on next fetch.
--   3. Installs a BEFORE INSERT OR UPDATE trigger that auto-assigns
--      display_order = max + 1 the moment a question transitions to
--      is_published = true. New approved questions therefore land
--      at the TOP of the feed (since the feed is ORDER BY
--      display_order DESC) -- preserving the user expectation that
--      newly contributed content shows up at the top, while everything
--      that existed before this migration is permanently randomized.
--   4. Adds a partial DESC index on display_order WHERE is_published
--      = true so the pagination query stays O(log n).
--
-- Coexists with the previous created_at index from migration
-- 20260526000000 -- that index is now unused by the public feed but
-- preserved for potential admin / analytics queries.

-- Step 1: column
ALTER TABLE "public"."seek_questions"
  ADD COLUMN IF NOT EXISTS "display_order" integer;

-- Step 2: one-time shuffle of currently published rows.
-- row_number() OVER (ORDER BY random()) guarantees unique sequential
-- values 1..N. The WITH clause computes the mapping; the UPDATE
-- applies it via a single JOIN-on-id.
WITH shuffled AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY random()) AS rn
  FROM "public"."seek_questions"
  WHERE "is_published" = true
)
UPDATE "public"."seek_questions" sq
SET "display_order" = shuffled.rn
FROM shuffled
WHERE sq."id" = shuffled."id";

-- Step 3: trigger function + trigger.
-- Fires BEFORE INSERT OR UPDATE OF is_published, but only assigns
-- when:
--   - NEW.is_published = true (the row is or just became public)
--   - NEW.display_order IS NULL (we haven't already assigned, e.g.
--     a row inserted as published with display_order pre-set by
--     the caller would be respected)
-- Concurrent admin approves theoretically race on the MAX read,
-- but admin approval is human-paced (one-at-a-time UI action) so
-- the practical collision rate is zero. Not worth the
-- pg_advisory_lock complexity.
CREATE OR REPLACE FUNCTION "public"."assign_seek_question_display_order"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."is_published" = true AND NEW."display_order" IS NULL THEN
    SELECT COALESCE(MAX("display_order"), 0) + 1
    INTO NEW."display_order"
    FROM "public"."seek_questions"
    WHERE "is_published" = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_seek_questions_assign_display_order"
  ON "public"."seek_questions";

CREATE TRIGGER "trg_seek_questions_assign_display_order"
  BEFORE INSERT OR UPDATE OF "is_published" ON "public"."seek_questions"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."assign_seek_question_display_order"();

-- Step 4: index for the new ORDER BY column.
-- Partial WHERE is_published = true matches commit 20260526000000's
-- index style and keeps the index slim.
CREATE INDEX IF NOT EXISTS "idx_seek_questions_display_order"
  ON "public"."seek_questions" USING "btree" ("display_order" DESC)
  WHERE ("is_published" = true);
