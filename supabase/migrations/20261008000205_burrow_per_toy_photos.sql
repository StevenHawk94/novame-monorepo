-- A face crop belongs to one owned costume, not to the user's entire toy shelf.
-- Keep the existing private-media lifecycle and immutable upload receipts.
alter table public.room_photos add column if not exists toy_id text not null default '';
alter table public.room_photo_uploads add column if not exists toy_id text not null default '';
alter table public.room_photos drop constraint if exists room_photos_pair_low_pair_high_owner_id_kind_key;
create unique index if not exists room_photos_toy_target on public.room_photos(pair_low,pair_high,owner_id,kind,toy_id);
drop index if exists public.room_doll_actor_day;
create unique index if not exists room_doll_actor_toy_day on public.room_photo_uploads(actor_id,owner_id,toy_id,committed_date)
  where kind='doll' and committed_at is not null;

-- Resolve the same shared/legacy/default costume that roomSlots displays.
create or replace function public.current_burrow_toy_v1(p_owner uuid,p_partner uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(
    (select item_id from room_loadouts where room_type='our' and slot='couple_doll'
      and pair_low=least(p_owner,p_partner) and pair_high=greatest(p_owner,p_partner) and p_partner is not null limit 1),
    (select item_id from room_loadouts where room_type='home' and slot='couple_doll'
      and owner_id=case when p_partner is null then p_owner else least(p_owner,p_partner) end
      and not exists(select 1 from room_loadouts l join catalog_items c on c.stable_id=l.item_id
        where p_partner is not null and l.room_type='our' and l.pair_low=least(p_owner,p_partner)
          and l.pair_high=greatest(p_owner,p_partner) and c.item_type='decor' and c.status='active') limit 1),
    (select stable_id from catalog_items where category='couple_dolls' and item_type='decor'
      and metadata->>'slot'='couple_doll' and metadata->>'starter'='true' and status='active' order by stable_id limit 1))
$$;

-- Preserve the old face on the equipped toy only. Never replicate its crop to
-- every owned toy. Photo ID/version/path remain unchanged, preserving cache.
update public.room_photos set toy_id=coalesce(public.current_burrow_toy_v1(owner_id,
  case when pair_low=pair_high then null when pair_low=owner_id then pair_high else pair_low end),'')
where kind='doll' and toy_id='';
update public.room_photo_uploads u set toy_id=p.toy_id from public.room_photos p
where u.kind='doll' and u.toy_id='' and p.private_path=u.private_path;

-- Frames and older callers still use the existing attachment functions. Their
-- empty toy_id remains a separate legacy target; fix the conflict inference.
do $$ declare signature text; definition text; begin
  foreach signature in array array['public.complete_room_photo_before_expiry_v1(uuid,uuid)',
    'public.solo_burrow_complete_photo_v1(uuid,uuid)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    definition:=replace(definition,'on conflict(pair_low,pair_high,owner_id,kind)',
      'on conflict(pair_low,pair_high,owner_id,kind,toy_id)');
    execute definition;
  end loop;
end $$;

create or replace function public.prepare_toy_photo_v1(p_user_id uuid,p_owner_id uuid,p_toy_id text,
  p_partner_id uuid,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item text; ticket room_photo_uploads%rowtype; today date; zone text;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is distinct from p_partner_id then return jsonb_build_object('error','pair_changed'); end if;
  if partner is null then perform lock_burrow_inventory(p_user_id,p_user_id); end if;
  if p_owner_id is distinct from p_user_id or p_key is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    then return jsonb_build_object('error','invalid_request'); end if;
  item:=coalesce(nullif(p_toy_id,''),current_burrow_toy_v1(p_user_id,partner));
  if item is null then return jsonb_build_object('error','toy_required'); end if;
  select * into ticket from room_photo_uploads where actor_id=p_user_id and command_key=p_key for update;
  if found then
    if ticket.owner_id<>p_owner_id or ticket.kind<>'doll' or ticket.toy_id<>item or ticket.digest<>p_digest
      or ticket.partner_id<>coalesce(partner,p_user_id) then return jsonb_build_object('error','idempotency_conflict'); end if;
    if ticket.expired_at is not null or (ticket.committed_at is null and ticket.created_at<now()-interval '24 hours')
      then return jsonb_build_object('error','upload_expired'); end if;
    return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,'committed',ticket.committed_at is not null,'toyId',item);
  end if;
  if not exists(select 1 from catalog_items c join content_revisions r on r.id=c.revision_id
    where c.stable_id=item and c.item_type='decor' and c.category='couple_dolls' and c.metadata->>'slot'='couple_doll'
      and c.status='active' and r.status='published' and (c.metadata->>'starter'='true'
        or exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=item)))
    then return jsonb_build_object('error','item_not_owned'); end if;
  select coalesce(nullif(timezone_name,''),'UTC') into zone from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  today:=(now() at time zone zone)::date;
  if exists(select 1 from room_photo_uploads where actor_id=p_user_id and owner_id=p_owner_id
    and kind='doll' and toy_id=item and committed_date=today and committed_at is not null)
    then return jsonb_build_object('error','daily_limit_reached'); end if;
  insert into room_photo_uploads(actor_id,partner_id,owner_id,kind,toy_id,command_key,digest,private_path)
    values(p_user_id,coalesce(partner,p_user_id),p_owner_id,'doll',item,p_key,p_digest,
      p_user_id::text||'/'||gen_random_uuid()::text||'.jpg') returning * into ticket;
  return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,'committed',false,'toyId',item);
end $$;

create or replace function public.complete_toy_photo_v1(p_user_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; ticket room_photo_uploads%rowtype; today date; zone text; photo_id uuid;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then perform lock_burrow_inventory(p_user_id,p_user_id); end if;
  select * into ticket from room_photo_uploads where id=p_ticket_id and actor_id=p_user_id for update;
  if not found or ticket.kind<>'doll' or ticket.toy_id='' or ticket.owner_id<>p_user_id then return jsonb_build_object('error','not_found'); end if;
  if ticket.partner_id<>coalesce(partner,p_user_id) then return jsonb_build_object('error','pair_changed'); end if;
  if ticket.expired_at is not null or (ticket.committed_at is null and ticket.created_at<now()-interval '24 hours')
    then return jsonb_build_object('error','upload_expired'); end if;
  if ticket.committed_at is not null then return jsonb_build_object('error',null,'applied',false); end if;
  if not exists(select 1 from catalog_items c where c.stable_id=ticket.toy_id and c.item_type='decor'
    and c.category='couple_dolls' and c.metadata->>'slot'='couple_doll' and (c.metadata->>'starter'='true'
      or exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=ticket.toy_id)))
    then return jsonb_build_object('error','item_not_owned'); end if;
  select coalesce(nullif(timezone_name,''),'UTC') into zone from profiles where id=p_user_id;
  today:=(now() at time zone zone)::date;
  if exists(select 1 from room_photo_uploads where actor_id=p_user_id and owner_id=p_user_id and kind='doll'
    and toy_id=ticket.toy_id and committed_date=today and committed_at is not null)
    then return jsonb_build_object('error','daily_limit_reached'); end if;
  insert into room_photos(pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by)
    values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,
      'doll',ticket.toy_id,ticket.private_path,p_user_id)
    on conflict(pair_low,pair_high,owner_id,kind,toy_id) do update set private_path=excluded.private_path,
      updated_by=p_user_id,updated_at=clock_timestamp() returning id into photo_id;
  update room_photo_uploads set committed_at=now(),committed_date=today where id=ticket.id;
  insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,p_user_id,
      'room_media_updated','room_photo',photo_id::text,jsonb_build_object('kind','doll','toyId',ticket.toy_id),'room-photo:'||ticket.id::text);
  return jsonb_build_object('error',null,'applied',true,'photoId',photo_id);
end $$;

do $$ begin
  if to_regprocedure('public.burrow_bootstrap_before_toy_photos_v1(uuid)') is null then
    alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_before_toy_photos_v1;
  end if;
end $$;
create or replace function public.burrow_bootstrap_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; partner uuid;
begin
  result:=burrow_bootstrap_before_toy_photos_v1(p_user_id);
  if result->>'error' is not null then return result; end if;
  partner:=(result->'partner'->>'id')::uuid;
  return result||jsonb_build_object(
    'roomPhotos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'ownerId',owner_id,'kind',kind,
      'toyId',nullif(toy_id,''),'updatedAt',updated_at)) from room_photos
      where (pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner))
        or (pair_low=p_user_id and pair_high=p_user_id and owner_id=p_user_id)),'[]'::jsonb),
    'dollPhotoChangesUsed',coalesce((select jsonb_agg(distinct toy_id) from room_photo_uploads
      where actor_id=p_user_id and kind='doll' and toy_id<>'' and committed_date=(result->>'localDate')::date
        and committed_at is not null),'[]'::jsonb));
end $$;
revoke all on function public.current_burrow_toy_v1(uuid,uuid),public.prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text),
  public.complete_toy_photo_v1(uuid,uuid),public.burrow_bootstrap_before_toy_photos_v1(uuid),public.burrow_bootstrap_v1(uuid)
  from public,anon,authenticated;
grant execute on function public.current_burrow_toy_v1(uuid,uuid),public.prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text),
  public.complete_toy_photo_v1(uuid,uuid),public.burrow_bootstrap_v1(uuid) to service_role;
grant select(toy_id) on public.room_photos to authenticated;
notify pgrst,'reload schema';
