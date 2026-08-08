-- Security hardening (2026-08-07 audit). Three anon-key-reachable holes.
--
-- The mobile app performs ZERO direct table writes (everything goes through
-- the service-role Next.js API), but the anon key ships in the app bundle and
-- an attacker can call Supabase directly with it. These fixes close the paths
-- that key could exploit. None of them affect the app (it touches none of
-- these directly).

-- ── BLOCKER: profiles is world-readable AND world-writable ───────────────────
-- "Service role can manage profiles" was created with USING(true) WITH
-- CHECK(true) and NO `TO` clause, so it applies to PUBLIC (anon + authenticated),
-- not service_role. Permissive policies are OR'd, so this single policy grants
-- SELECT/INSERT/UPDATE/DELETE on every profiles row to any anon-key holder —
-- letting a user self-grant subscription_tier='plus' (quota.js reads exactly
-- profiles.subscription_tier) and dump every user's email/birthday/etc.
--
-- service_role bypasses RLS unconditionally, so dropping this loses nothing.
-- profiles then correctly reduces to: view-own (SELECT), insert-own (INSERT),
-- and service-role bypass for writes. (The client-side UPDATE policy was
-- already dropped in 20260528000000.)
drop policy if exists "Service role can manage profiles" on public.profiles;

-- ── HIGH: legacy record_wisdom_usage is anon-callable and trusts p_user_id ────
-- SECURITY DEFINER, no auth.uid() check, WRITES subscriptions.records_today /
-- minutes_used_this_month for whatever p_user_id is passed. An anon caller can
-- exhaust any victim's quota. Unlike the v2 RPCs it was never revoked from
-- public. It is only invoked server-side (service_role), which keeps working.
revoke all on function public.record_wisdom_usage(uuid, integer) from anon;
revoke all on function public.record_wisdom_usage(uuid, integer) from authenticated;
revoke all on function public.record_wisdom_usage(uuid, integer) from public;

-- ── MEDIUM: legacy can_user_record leaks another user's plan/quota state ──────
-- Same missing-revoke problem; read-only, but returns an arbitrary user's tier
-- and usage counters when called with their id. Server-side callers use
-- service_role and are unaffected.
revoke all on function public.can_user_record(uuid) from anon;
revoke all on function public.can_user_record(uuid) from authenticated;
revoke all on function public.can_user_record(uuid) from public;

-- ── HIGH: wisdom_cards INSERT is open to the public (self-publish) ────────────
-- "Service role can insert cards" was created FOR INSERT WITH CHECK(true) with
-- no `TO`, so any anon-key holder can insert rows — and with user_id = NULL the
-- "Anyone can view default cards" policy makes them world-readable, bypassing
-- the insert_wisdom_card_if_under_quota publish-quota RPC. Writes go through the
-- service role (bypasses RLS), so dropping this loses nothing legitimate.
drop policy if exists "Service role can insert cards" on public.wisdom_cards;

-- ── MEDIUM: disposable_email_domains has no RLS at all ───────────────────────
-- The table was created without `enable row level security`, and anon inherits
-- ALL via default table privileges — so anyone can DELETE the signup blocklist
-- (neutralizing the abuse guard) or INSERT to block legit domains. Only
-- supabase_auth_admin needs it (explicit grant); enabling RLS with no policy
-- denies anon/authenticated while leaving the admin grant intact.
alter table public.disposable_email_domains enable row level security;
