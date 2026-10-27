-- Season is an automatic presentation choice shared with the Burrow banner,
-- never a sale, gift or adventure reward. Retire the former catalog products
-- without deleting inventory, receipts, saved layouts, wallets or photos.
begin;
select pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
update public.catalog_items
set status='retired', price=null, tradable=false, drop_weight=0,
    metadata=metadata||'{"starter":false,"automaticSeason":true}'::jsonb,
    updated_at=now()
where category='seasons' and metadata->>'slot'='background';
commit;
