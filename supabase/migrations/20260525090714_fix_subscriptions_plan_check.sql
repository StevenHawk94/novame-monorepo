-- Stage 5.IAP fix: align subscriptions.plan CHECK constraint with
-- packages/core PRICING_TIERS.
--
-- Background:
--   The constraint was last updated when the app used 'free'/'premium'
--   tiers. Code in packages/core/src/constants/pricing.ts has since
--   moved to 'free'/'basic'/'pro'/'ultra' (4-tier subscription model).
--   The 'premium' tier value lingered in the DB constraint, while
--   'basic' was never added.
--
-- Bug observed:
--   When a user purchased the 'basic' tier, the apple-iap endpoint
--   upserted a row with plan='basic'. The CHECK constraint rejected
--   it, returning HTTP 500. Worse, profiles.subscription_tier was
--   already updated by the time the subscriptions upsert ran, leaving
--   the user in a half-state (profile says basic, no subscription row),
--   which broke Apple's renewal webhook lookups.
--
-- Data safety check (run before this migration):
--   SELECT plan, COUNT(*) FROM subscriptions GROUP BY plan;
--     free   -> 126
--     pro    -> 3
--     ultra  -> 2
--     premium -> 0   (no rows on the dropped value, safe to drop)
--     basic   -> 0   (constraint blocked all attempts; will be valid
--                     going forward)

-- 1. Drop the legacy constraint.
ALTER TABLE "public"."subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_plan_check";

-- 2. Re-add with the correct tier set (free + 3 paid tiers).
ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_plan_check"
  CHECK ("plan" = ANY (ARRAY[
    'free'::text,
    'basic'::text,
    'pro'::text,
    'ultra'::text
  ]));
