-- Stable IDs/inventory/room_music are intentionally preserved. Music is never
-- purchased with carrots: Lofi is free; Lullaby and Jazz require shared Plus.
-- Quiet Cave remains a legacy silent starter, not a fourth playable song.
update public.catalog_items set title='Lofi',
  description='A bundled lo-fi soundtrack for your burrow.',
  asset=asset||'{"bundleKey":"lofi","loop":true}'::jsonb,is_placeholder=false,price=0,plus_only=false
where stable_id='placeholder_music_calm' and item_type='music';
update public.catalog_items set title='Lullaby',
  description='A bundled lullaby soundtrack for your burrow.',
  asset=asset||'{"bundleKey":"lullaby","loop":true}'::jsonb,is_placeholder=false,price=0,plus_only=true
where stable_id='placeholder_music_dream' and item_type='music';
update public.catalog_items set title='Jazz',
  description='A bundled jazz soundtrack for your burrow.',
  asset=asset||'{"bundleKey":"jazz","loop":true}'::jsonb,is_placeholder=false,price=0,plus_only=true
where stable_id='placeholder_music_02' and item_type='music';

-- No inventory purchase is needed. Check the same reciprocal-pair Plus
-- entitlement as Home; owning an old song is not a substitute for Plus.
create or replace function public.select_room_music_v1(p_user_id uuid,p_track_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item catalog_items%rowtype; partner uuid; paid boolean;
begin
  if not exists(select 1 from profiles where id=p_user_id) then
    return jsonb_build_object('error','profile_not_found'); end if;
  partner:=lock_burrow_pair(p_user_id);
  if p_track_id is not null then
    select c.* into item from catalog_items c join content_revisions r on r.id=c.revision_id
      where c.stable_id=p_track_id and c.item_type='music' and c.status='active' and r.status='published'
      for share of c;
    if not found then return jsonb_build_object('error','not_found'); end if;
    select exists(select 1 from profiles p where p.id in(p_user_id,partner)
      and coalesce(p.subscription_tier::text,'free')<>'free') into paid;
    if item.plus_only and not paid then return jsonb_build_object('error','plus_required'); end if;
  end if;
  insert into room_music(owner_id,track_id) values(p_user_id,p_track_id)
    on conflict(owner_id) do update set track_id=excluded.track_id,updated_at=now();
  return jsonb_build_object('error',null,'applied',true);
end $$;
revoke all on function public.select_room_music_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.select_room_music_v1(uuid,text) to service_role;
notify pgrst,'reload schema';
