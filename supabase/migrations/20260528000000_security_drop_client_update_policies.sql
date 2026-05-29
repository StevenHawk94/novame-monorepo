-- ============================================================
-- Security hardening: remove client-side UPDATE policies on
-- subscriptions and profiles.
--
-- Audit context (pre-App Store submission security review):
--   - RLS is enabled on all 32 public tables (verified).
--   - The mobile app performs ZERO direct Supabase writes
--     (no .update / .upsert / .insert / .delete, no .rpc).
--   - The only mobile .from('profiles') is a read:
--     growth.tsx .select('display_name, avatar_url').
--   - Every mutation flows through apps/api using service-role.
--
-- Removing two pure-attack-surface client UPDATE policies:
--   1. subscriptions UPDATE: a user could set their own tier/expiry
--      -> free premium. Must be server-only (StoreKit validated).
--   2. profiles UPDATE: RLS is row-level not column-level, so the
--      policy cannot stop a user editing aspire_scores /
--      better_self_score / wisdom_share_count / etc. All profile
--      writes already run server-side via service-role.
--
-- After: subscriptions keeps SELECT + service-role ALL; profiles
-- keeps SELECT + INSERT + service-role ALL. No client path affected.
-- ============================================================

DROP POLICY IF EXISTS "Users can update own subscription" ON subscriptions;

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
