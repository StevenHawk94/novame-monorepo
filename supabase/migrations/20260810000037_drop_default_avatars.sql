-- Drop the legacy server-side default-avatar system (2026-08-10).
--
-- v1 assigned every new profile a random remote URL from the
-- default_avatars table via a BEFORE INSERT trigger. The client now owns
-- defaults entirely: assets/profile/default-1..4.png picked
-- deterministically from the userId (apps/mobile/src/lib/avatar.ts), and
-- resolveAvatarSource already ignores any avatar_url whose
-- is_default_avatar is not false. This removes the dead machinery and the
-- stale rows it left behind.
--
-- After this migration:
--   * new profiles get avatar_url NULL + is_default_avatar true (column
--     default), which every API path already treats as "render the local
--     default";
--   * real uploads are untouched (is_default_avatar = false, set by
--     /api/upload-avatar).

DROP TRIGGER IF EXISTS trigger_assign_default_avatar ON public.profiles;
DROP FUNCTION IF EXISTS public.assign_default_avatar();
DROP FUNCTION IF EXISTS public.get_random_default_avatar();

-- Clear the legacy remote default URLs so no client ever sees them again.
-- (IS DISTINCT FROM catches both true and NULL.)
UPDATE public.profiles
SET avatar_url = NULL
WHERE avatar_url IS NOT NULL
  AND is_default_avatar IS DISTINCT FROM false;

DROP TABLE IF EXISTS public.default_avatars;
