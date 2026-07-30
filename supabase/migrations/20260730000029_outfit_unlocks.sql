-- 029: allow 'outfit' in cosmetic_unlocks.cosmetic_type (Bunny Closet,
-- 2026-07-30). Outfits are catalogued in R2's video-manifest.json; ownership
-- rows here use cosmetic_type='outfit', cosmetic_id=<outfit key slug>
-- (e.g. 'granny-sweater'). Purchase stays service-role-only; the existing
-- SELECT-own RLS policy and the (user_id, cosmetic_type, cosmetic_id)
-- unique constraint cover the new type unchanged.

ALTER TABLE public.cosmetic_unlocks
  DROP CONSTRAINT IF EXISTS cosmetic_unlocks_type_chk;

ALTER TABLE public.cosmetic_unlocks
  ADD CONSTRAINT cosmetic_unlocks_type_chk
  CHECK (cosmetic_type IN ('skin', 'scene', 'outfit'));
