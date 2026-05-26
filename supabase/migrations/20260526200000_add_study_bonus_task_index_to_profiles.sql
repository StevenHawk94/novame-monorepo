-- Add study_bonus_task_index column to profiles
--
-- Per-user counter that picks the next entry from the
-- STUDY_BONUS_TASK_TEMPLATES array in apps/api/src/lib/study-bonus-tasks.js.
--
-- Behavior:
--   - When a user completes a study session and POSTs /api/study-claim,
--     the server reads study_bonus_task_index, INSERTs a daily_task with
--     content = STUDY_BONUS_TASK_TEMPLATES[index], then increments the
--     index modulo array length.
--   - Result: each study claim creates a fresh task picked sequentially.
--     After all 24 templates are used, the cycle restarts from index 0.
--
-- Why per-user (not global): each user's progression through the cycle is
-- independent. User A's 5th study claim shows template #4 (0-indexed),
-- which has no relationship to User B's 5th claim.
--
-- Default 0 matches the array's first index, so a new user's first study
-- claim picks STUDY_BONUS_TASK_TEMPLATES[0].

ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "study_bonus_task_index" integer DEFAULT 0 NOT NULL;
