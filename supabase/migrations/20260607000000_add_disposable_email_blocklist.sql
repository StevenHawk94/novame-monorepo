-- ============================================================
-- Anti-abuse: disposable / temporary email blocklist + Auth Hook
-- function for the Before User Created hook.
--
-- Context (cost-protection against bot sign-up abuse):
--   - Each free account grants 1 AI insight generation. Email sign-up
--     requires an OTP, which already blocks random fake addresses, but
--     does NOT stop scripted sign-ups using disposable-mailbox services
--     (temp-mail etc.) that can receive the OTP and be generated at will.
--   - A bot farm could register N disposable mailboxes -> N free AI
--     calls -> inflated Gemini cost.
--
-- Defense: a Before User Created Auth Hook rejects sign-ups whose email
-- domain is on a community-maintained disposable-domain blocklist. This
-- runs server-side on EVERY sign-up path (app or direct API), so it
-- cannot be bypassed and needs no app release.
--
-- fail-open by design: any error inside the function (or a missing/
-- malformed email) returns the event unchanged (allow), so a fault in
-- this anti-abuse component can never block legitimate sign-ups.
--
-- The blocklist rows are loaded by a separate seed migration. The hook
-- itself is wired in the Supabase Dashboard (Authentication > Hooks >
-- Before User Created -> Postgres -> public.check_disposable_email),
-- which is platform config and cannot live in a migration.
-- ============================================================

-- Blocklist table (domain is the primary key -> indexed lookups).
CREATE TABLE IF NOT EXISTS public.disposable_email_domains (
  domain text PRIMARY KEY
);

-- Before User Created hook function. Supabase passes the sign-up event
-- as jsonb and expects jsonb back: an { "error": {...} } object rejects
-- the sign-up; returning the event unchanged allows it.
CREATE OR REPLACE FUNCTION public.check_disposable_email(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email   text;
  email_domain text;
  is_disposable boolean;
BEGIN
  user_email := lower(event->'user'->>'email');

  -- fail-open: no email to check -> allow.
  IF user_email IS NULL OR user_email = '' THEN
    RETURN event;
  END IF;

  email_domain := split_part(user_email, '@', 2);
  IF email_domain IS NULL OR email_domain = '' THEN
    RETURN event;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.disposable_email_domains WHERE domain = email_domain
  ) INTO is_disposable;

  IF is_disposable THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Please use a different email address to sign up.'
      )
    );
  END IF;

  RETURN event;
EXCEPTION
  WHEN OTHERS THEN
    -- fail-open: never block a sign-up because the blocklist check broke.
    RETURN event;
END;
$$;

-- The hook is invoked by the supabase_auth_admin role; grant it the
-- minimum needed and revoke from everyone else.
GRANT EXECUTE ON FUNCTION public.check_disposable_email(jsonb) TO supabase_auth_admin;
GRANT SELECT ON public.disposable_email_domains TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.check_disposable_email(jsonb) FROM authenticated, anon, public;
