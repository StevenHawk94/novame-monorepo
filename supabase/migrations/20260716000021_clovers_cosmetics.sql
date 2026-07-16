-- Clovers economy + cosmetic unlocks.
--
-- Clovers replace the old xp/level system as the single currency. We keep
-- companions.xp as the *lifetime earned* total (every reflect/kit/focus still
-- pays into it, unchanged), and track spend separately so the balance is
-- xp - clovers_spent. Level/exp are no longer surfaced.
--
-- cosmetic_unlocks records which skins/scenes a user has bought with clovers,
-- so an unlock persists across sessions and devices.

-- 1. Spend counter on the companion (balance = xp - clovers_spent).
ALTER TABLE "public"."companions"
  ADD COLUMN IF NOT EXISTS "clovers_spent" integer NOT NULL DEFAULT 0;

-- 2. Purchased cosmetics (skins + scenes; extensible to future types).
CREATE TABLE IF NOT EXISTS "public"."cosmetic_unlocks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "cosmetic_type" text NOT NULL,   -- 'skin' | 'scene'
  "cosmetic_id" text NOT NULL,     -- e.g. 'pet1-skin3', 'scene4'
  "unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cosmetic_unlocks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cosmetic_unlocks_type_chk" CHECK ("cosmetic_type" IN ('skin', 'scene')),
  CONSTRAINT "cosmetic_unlocks_unique" UNIQUE ("user_id", "cosmetic_type", "cosmetic_id")
);

ALTER TABLE "public"."cosmetic_unlocks" OWNER TO "postgres";
ALTER TABLE "public"."cosmetic_unlocks" ENABLE ROW LEVEL SECURITY;

-- Users read their own unlocks; only the service role writes (purchases go
-- through a server route that checks the balance first).
CREATE POLICY "cosmetic_unlocks_select_own" ON "public"."cosmetic_unlocks"
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS "idx_cosmetic_unlocks_user"
  ON "public"."cosmetic_unlocks" USING btree ("user_id", "cosmetic_type");
