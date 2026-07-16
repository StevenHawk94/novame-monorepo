-- Weekly Quests: a user's active 7-day plan.
--
-- A user commits to one plan at a time (self or a friend co-op). The 7 chosen
-- tasks live in `tasks` jsonb, each with its done state + the date it was
-- checked. Day advances by calendar day from started_on; one check-off per day
-- (enforced by the check route via last_check_date). Rewards are paid into
-- clovers (companions.xp) by the check route, not here.
--
-- Friend plans reference a friendship; both sides have their own row linked by
-- pair_id, and the completion bonus only pays when both finish (Stage 2).

CREATE TABLE IF NOT EXISTS "public"."quest_plans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "theme_key" text NOT NULL,             -- 'fitness' | 'study' | 'custom' | 'write_own' | ...
  "title" text NOT NULL,                 -- theme title or user's custom goal
  "scope" text NOT NULL DEFAULT 'self',  -- 'self' | 'friend'
  "status" text NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'expired'
  "tasks" jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ text, reward, done, done_date }]
  "started_on" date NOT NULL,            -- local date the plan began (day 1)
  "last_check_date" date,                -- local date of the last check-off (one/day)
  "checked_count" integer NOT NULL DEFAULT 0,
  "bonus_paid" boolean NOT NULL DEFAULT false,
  -- Friend co-op (Stage 2):
  "pair_id" uuid,                        -- links the two sides of a friend plan
  "friend_id" uuid,                      -- the other user
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quest_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quest_plans_scope_chk" CHECK ("scope" IN ('self', 'friend')),
  CONSTRAINT "quest_plans_status_chk" CHECK ("status" IN ('active', 'completed', 'expired'))
);

ALTER TABLE "public"."quest_plans" OWNER TO "postgres";
ALTER TABLE "public"."quest_plans" ENABLE ROW LEVEL SECURITY;

-- Users read their own plans; writes go through server routes (service role).
CREATE POLICY "quest_plans_select_own" ON "public"."quest_plans"
  FOR SELECT USING (auth.uid() = user_id);

-- One active plan per user (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_quest_plans_one_active"
  ON "public"."quest_plans" ("user_id") WHERE ("status" = 'active');

CREATE INDEX IF NOT EXISTS "idx_quest_plans_user_status"
  ON "public"."quest_plans" USING btree ("user_id", "status");

CREATE INDEX IF NOT EXISTS "idx_quest_plans_pair"
  ON "public"."quest_plans" USING btree ("pair_id") WHERE ("pair_id" IS NOT NULL);
