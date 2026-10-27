-- Partner Room can replace only the currently displayed toy's face. Frames,
-- memories and other rooms keep their existing permissions and private storage.
create or replace function public.burrow_toy_photo_target_allowed_v1(
  p_actor uuid,p_owner uuid,p_toy text,p_partner uuid
) returns boolean language sql stable security definer set search_path=public as $$
  select p_owner is not null and (p_owner=p_actor or p_owner=p_partner)
    and (p_owner=p_actor or p_toy=current_burrow_toy_v1(p_owner,p_actor))
    and exists(select 1 from catalog_items c join content_revisions r on r.id=c.revision_id
      where c.stable_id=p_toy and c.item_type='decor' and c.category='couple_dolls'
        and c.metadata->>'slot'='couple_doll' and c.status='active' and r.status='published'
        and (c.metadata->>'starter'='true'
          or exists(select 1 from user_inventory i where i.owner_id=p_owner and i.item_id=p_toy)
          -- Current paired decoration may be owned by either partner.
          or (p_partner is not null and p_toy=current_burrow_toy_v1(p_owner,
                case when p_owner=p_actor then p_partner else p_actor end)
            and exists(select 1 from user_inventory i where i.owner_id in(p_actor,p_partner) and i.item_id=p_toy))));
$$;

create or replace function public.prepare_toy_photo_v1(p_user_id uuid,p_owner_id uuid,p_toy_id text,
  p_partner_id uuid,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item text; ticket room_photo_uploads%rowtype; today date; zone text;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is distinct from p_partner_id then return jsonb_build_object('error','pair_changed'); end if;
  if partner is null then perform lock_burrow_inventory(p_user_id,p_user_id); end if;
  if p_owner_id is null or (p_owner_id<>p_user_id and p_owner_id is distinct from partner)
    or p_key is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    then return jsonb_build_object('error','invalid_request'); end if;
  item:=coalesce(nullif(p_toy_id,''),current_burrow_toy_v1(p_owner_id,
    case when p_owner_id=p_user_id then partner else p_user_id end));
  if item is null then return jsonb_build_object('error','toy_required'); end if;
  select * into ticket from room_photo_uploads where actor_id=p_user_id and command_key=p_key for update;
  if found then
    if ticket.owner_id<>p_owner_id or ticket.kind<>'doll' or ticket.toy_id<>item or ticket.digest<>p_digest
      or ticket.partner_id<>coalesce(partner,p_user_id) then return jsonb_build_object('error','idempotency_conflict'); end if;
    if ticket.expired_at is not null or (ticket.committed_at is null and ticket.created_at<now()-interval '24 hours')
      then return jsonb_build_object('error','upload_expired'); end if;
    return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,'committed',ticket.committed_at is not null,'toyId',item);
  end if;
  if not burrow_toy_photo_target_allowed_v1(p_user_id,p_owner_id,item,partner)
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
  if not found or ticket.kind<>'doll' or ticket.toy_id='' then return jsonb_build_object('error','not_found'); end if;
  if ticket.partner_id<>coalesce(partner,p_user_id)
    or (ticket.owner_id<>p_user_id and ticket.owner_id is distinct from partner)
    then return jsonb_build_object('error','pair_changed'); end if;
  if ticket.expired_at is not null or (ticket.committed_at is null and ticket.created_at<now()-interval '24 hours')
    then return jsonb_build_object('error','upload_expired'); end if;
  if ticket.committed_at is not null then return jsonb_build_object('error',null,'applied',false); end if;
  if not burrow_toy_photo_target_allowed_v1(p_user_id,ticket.owner_id,ticket.toy_id,partner)
    then return jsonb_build_object('error','item_not_owned'); end if;
  -- Per actor + room owner + costume, never one shared quota for both rooms.
  select coalesce(nullif(timezone_name,''),'UTC') into zone from profiles where id=p_user_id;
  today:=(now() at time zone zone)::date;
  if exists(select 1 from room_photo_uploads where actor_id=p_user_id and owner_id=ticket.owner_id and kind='doll'
    and toy_id=ticket.toy_id and committed_date=today and committed_at is not null)
    then return jsonb_build_object('error','daily_limit_reached'); end if;
  insert into room_photos(pair_low,pair_high,owner_id,kind,toy_id,private_path,updated_by)
    values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),ticket.owner_id,
      'doll',ticket.toy_id,ticket.private_path,p_user_id)
    on conflict(pair_low,pair_high,owner_id,kind,toy_id) do update set private_path=excluded.private_path,
      updated_by=p_user_id,updated_at=clock_timestamp() returning id into photo_id;
  update room_photo_uploads set committed_at=now(),committed_date=today where id=ticket.id;
  insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(least(p_user_id,coalesce(partner,p_user_id)),greatest(p_user_id,coalesce(partner,p_user_id)),p_user_id,ticket.owner_id,
      'room_media_updated','room_photo',photo_id::text,jsonb_build_object('kind','doll','toyId',ticket.toy_id),'room-photo:'||ticket.id::text);
  return jsonb_build_object('error',null,'applied',true,'photoId',photo_id);
end $$;

do $$ begin
  if to_regprocedure('public.burrow_bootstrap_before_partner_room_v1(uuid)') is null then
    alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_before_partner_room_v1;
  end if;
end $$;
create or replace function public.burrow_bootstrap_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; partner uuid;
begin
  result:=burrow_bootstrap_before_partner_room_v1(p_user_id);
  if result->>'error' is not null then return result; end if;
  partner:=(result->'partner'->>'id')::uuid;
  return result||jsonb_build_object(
    'dollPhotoChangesUsed',coalesce((select jsonb_agg(distinct toy_id) from room_photo_uploads
      where actor_id=p_user_id and owner_id=p_user_id and kind='doll' and toy_id<>''
        and committed_date=(result->>'localDate')::date and committed_at is not null),'[]'::jsonb),
    'dollPhotoChangeTargetsUsed',coalesce((select jsonb_agg(jsonb_build_object('ownerId',owner_id,'toyId',toy_id))
      from room_photo_uploads where actor_id=p_user_id and owner_id in(p_user_id,partner)
        and kind='doll' and toy_id<>'' and committed_date=(result->>'localDate')::date and committed_at is not null),'[]'::jsonb),
    'partnerLastCareAt',jsonb_build_object(
      'food',(select max(created_at) from moment_events where target_id=partner and event_type='room_need_refilled' and payload->>'need'='food'),
      'water',(select max(created_at) from moment_events where target_id=partner and event_type='room_need_refilled' and payload->>'need'='water')));
end $$;
revoke all on function public.burrow_toy_photo_target_allowed_v1(uuid,uuid,text,uuid),
  public.prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text),public.complete_toy_photo_v1(uuid,uuid),
  public.burrow_bootstrap_before_partner_room_v1(uuid),public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
revoke all on function public.burrow_bootstrap_before_partner_room_v1(uuid) from service_role;
grant execute on function public.prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text),
  public.complete_toy_photo_v1(uuid,uuid),public.burrow_bootstrap_v1(uuid) to service_role;
notify pgrst,'reload schema';
