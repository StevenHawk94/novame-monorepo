-- Read-only reporting on committed purchase receipts. Inventory also contains
-- rewards/starters, so it must never be used as a sales counter.
begin;
create index if not exists catalog_purchases_paid_reporting
  on public.catalog_purchases(created_at, item_id)
  where status = 'completed' and price_snapshot > 0;

create or replace function public.admin_shop_sales_v1(
  p_since timestamptz default null,
  p_until timestamptz default now(),
  p_kind text default 'all'
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with paid as (
    select p.item_id, count(*) as purchases,
      count(*) filter (where p.buyer_id = p.recipient_id) as self_purchases,
      count(*) filter (where p.buyer_id <> p.recipient_id) as gift_purchases,
      sum(p.price_snapshot)::bigint as coins_spent
    from public.catalog_purchases p
    join public.catalog_items c on c.stable_id = p.item_id
    where p.status = 'completed' and p.price_snapshot > 0
      and (p_since is null or p.created_at >= p_since) and p.created_at < p_until
      and (p_kind = 'all' or p_kind = 'self' and p.buyer_id = p.recipient_id
        or p_kind = 'gift' and p.buyer_id <> p.recipient_id)
      and c.item_type in ('decor', 'outfit')
      and c.category in ('outfits','wallpapers','couple_dolls','cushions','tables','rugs',
        'vases','lamps','windows','cabinets','music_players','frames','dresser_plants',
        'light_strings','ladders','shelves')
      and coalesce(c.metadata->>'starter', 'false') <> 'true'
    group by p.item_id
  )
  -- One JSON aggregate avoids PostgREST's row cap silently truncating rankings.
  select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(report)
    order by report.purchases desc, report.category, report.title, report.item_id), '[]'::jsonb))
  from (select c.stable_id as item_id, c.category, c.title, c.status as item_status,
    c.price as current_price, c.metadata, coalesce(p.purchases, 0) as purchases,
    coalesce(p.self_purchases, 0) as self_purchases,
    coalesce(p.gift_purchases, 0) as gift_purchases, coalesce(p.coins_spent, 0) as coins_spent
  from public.catalog_items c left join paid p on p.item_id = c.stable_id
  where c.item_type in ('decor', 'outfit')
    and c.category in ('outfits','wallpapers','couple_dolls','cushions','tables','rugs',
      'vases','lamps','windows','cabinets','music_players','frames','dresser_plants',
      'light_strings','ladders','shelves')
    and coalesce(c.metadata->>'starter', 'false') <> 'true'
    and (p.purchases > 0 or c.status = 'active' and c.price > 0
      and c.revision_id = (select value from public.app_config where key = 'app_major_update_content_revision'))
  ) report;
$$;
revoke all on function public.admin_shop_sales_v1(timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.admin_shop_sales_v1(timestamptz,timestamptz,text) to service_role;
commit;
