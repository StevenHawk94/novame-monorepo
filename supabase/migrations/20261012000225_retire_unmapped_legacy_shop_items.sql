-- Retire the seven confirmed legacy placeholders without deleting catalog or
-- historical inventory, gift, purchase, or adventure records.
begin;

select pg_advisory_xact_lock(hashtextextended('burrow-shop-prices', 0));

update public.catalog_items
set status = 'retired',
    tradable = false,
    drop_weight = 0,
    metadata = coalesce(metadata, '{}'::jsonb)
      || '{"retirementReason":"missing_local_art_legacy_placeholder"}'::jsonb,
    updated_at = now()
where stable_id in (
  'adventure_fossil_lamp_01',
  'friend_visit_lamp_1',
  'friend_visit_lamp_2',
  'friend_visit_lamp_3',
  'friend_visit_vase_1',
  'friend_visit_vase_2',
  'friend_visit_vase_3'
)
  and status = 'active'
  and item_type = 'decor'
  and category in ('lamps', 'vases')
  -- Do not retire a placeholder if it has since received real artwork.
  and asset->>'renderer' = 'native'
  and metadata->>'artOrdinal' is null;

commit;
