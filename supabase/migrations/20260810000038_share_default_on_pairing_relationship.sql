-- 2026-08-10 product rulings:
--
-- 1) Memory-detail sharing defaults ON. The Friends-page gear was default-
--    private (share_memory_details false), while the per-reflect toggle
--    defaults visible — contradictory. The master switch now defaults true;
--    users hide individual reflects from the post-reflect reward screen.
--    Beta-stage blanket update: existing rows flip to true as well.
ALTER TABLE public.profiles ALTER COLUMN share_memory_details SET DEFAULT true;
UPDATE public.profiles SET share_memory_details = true WHERE share_memory_details IS DISTINCT FROM true;

-- 2) Backfill pairings.relationship from the invitation. Pairings formed
--    through the old POST /api/friends/pair path (which didn't pass the
--    relationship to set_pairing) show the 'Paired' fallback instead of the
--    inviter's choice (e.g. Families). Copy it from the friendship row.
UPDATE public.pairings p
SET relationship       = f.relationship,
    relationship_since = COALESCE(p.relationship_since, f.relationship_since)
FROM public.friendships f
WHERE p.relationship IS NULL
  AND f.user_a = LEAST(p.user_id, p.partner_user_id)
  AND f.user_b = GREATEST(p.user_id, p.partner_user_id)
  AND f.relationship IS NOT NULL;
