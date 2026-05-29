-- ============================================================
-- Phase A.1 (Module 6 #4 followup): harden storage.objects SELECT RLS
--
-- BEFORE:
--   "Public Access"          SELECT  bucket_id='audio'       (no owner check)
--   "Public Access avatars"  SELECT  bucket_id='avatars'     (no owner check)
--
-- Module 6 pentest confirmed these allow any anon caller to LIST every
-- object in both buckets. Concretely:
--
--   POST /storage/v1/object/list/audio   { "prefix": "", "limit": 100 }
--     -> returns every userId folder name (16 real user UUIDs leaked)
--   POST /storage/v1/object/list/audio   { "prefix": "{userId}/" }
--     -> returns every file in that user's folder + size + timestamp,
--        which is enough to construct the public URL and download the
--        original audio recording (private wisdoms included).
--
-- AFTER:
--   "Owner or service role can list audio"     SELECT
--     bucket_id='audio'   AND (service_role OR auth.uid()=folder[0])
--   "Owner or service role can list avatars"   SELECT
--     bucket_id='avatars' AND (service_role OR auth.uid()=folder[0])
--
-- The folder check uses Supabase's official pattern:
--   storage.foldername(name)[1]  -- first path segment
-- Files in both buckets are uploaded as "${userId}/${timestamp}.webm"
-- (see apps/api/src/app/api/publish-wisdom/route.js line 223) and
-- "${userId}/${timestamp}.jpg" (see upload-avatar/route.js line 152),
-- so the first segment is always the owner's UUID.
--
-- Side effects:
--   - anon LIST root  -> 403 (auth.uid() is null, folder check fails)
--   - anon LIST other user's folder -> 403 (uid mismatch)
--   - user LIST own folder -> 200 (uid matches)
--   - service_role (apps/api) -> 200 (bypass via role check)
--   - public GET single file URL -> unaffected (CDN bypass, does NOT
--     query storage.objects RLS for public buckets)
-- ============================================================

-- audio bucket
drop policy if exists "Public Access" on storage.objects;
create policy "Owner or service role can list audio"
  on storage.objects
  for select
  to public
  using (
    bucket_id = 'audio'
    and (
      auth.role() = 'service_role'
      or (auth.uid())::text = (storage.foldername(name))[1]
    )
  );

-- avatars bucket
drop policy if exists "Public Access avatars" on storage.objects;
create policy "Owner or service role can list avatars"
  on storage.objects
  for select
  to public
  using (
    bucket_id = 'avatars'
    and (
      auth.role() = 'service_role'
      or (auth.uid())::text = (storage.foldername(name))[1]
    )
  );
