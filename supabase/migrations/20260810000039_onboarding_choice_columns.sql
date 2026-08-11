-- Onboarding funnel analytics (2026-08-10): persist the two intro answers
-- so admin can chart user leanings. Written once by the app at onboarding
-- finish via /api/update-profile.
--   onboarding_who     : partner | bestie | family | special
--   onboarding_blocker : A (busy) | B (far apart) | C (bother) | D (what to say)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_who text,
  ADD COLUMN IF NOT EXISTS onboarding_blocker text;
