-- Personal frames and doll portraits can be saved before pairing. The
-- immutable upload ticket remains digest-bound and scoped to the actor.
alter table public.room_photos drop constraint if exists room_photos_check;
alter table public.room_photos add constraint room_photos_check
  check(pair_low<=pair_high and owner_id in(pair_low,pair_high));

create or replace function public.solo_burrow_prepare_photo_v1(
  p_user_id uuid,p_owner_id uuid,p_kind text,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket room_photo_uploads%rowtype; local_day date; zone text; ticket_id uuid;
begin
  if p_owner_id is distinct from p_user_id or p_kind not in('frame','doll') or p_key is null
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    then return jsonb_build_object('error','invalid_request'); end if;
  select * into ticket from room_photo_uploads where actor_id=p_user_id and command_key=p_key;
  if found then
    if ticket.owner_id<>p_user_id or ticket.kind<>p_kind or ticket.digest<>p_digest or ticket.partner_id<>p_user_id
      then return jsonb_build_object('error','idempotency_conflict'); end if;
    return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,
      'committed',ticket.committed_at is not null);
  end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  select coalesce(nullif(timezone_name,''),'UTC') into zone from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','profile_not_found'); end if;
  local_day:=(now() at time zone zone)::date;
  if p_kind='doll' and exists(select 1 from room_photo_uploads where actor_id=p_user_id
    and kind='doll' and committed_date=local_day)
    then return jsonb_build_object('error','daily_limit_reached'); end if;
  ticket_id:=gen_random_uuid();
  insert into room_photo_uploads(id,actor_id,partner_id,owner_id,kind,command_key,digest,private_path)
    values(ticket_id,p_user_id,p_user_id,p_user_id,p_kind,p_key,p_digest,
      p_user_id::text||'/'||ticket_id::text||'.jpg') returning * into ticket;
  return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,'committed',false);
end $$;

create or replace function public.solo_burrow_complete_photo_v1(p_user_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket room_photo_uploads%rowtype; local_day date; zone text; photo_id uuid;
begin
  select * into ticket from room_photo_uploads where id=p_ticket_id and actor_id=p_user_id
    and partner_id=p_user_id and owner_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if ticket.committed_at is not null then return jsonb_build_object('error',null,'applied',false); end if;
  select coalesce(nullif(timezone_name,''),'UTC') into zone from profiles where id=p_user_id;
  local_day:=(now() at time zone zone)::date;
  if ticket.kind='doll' and exists(select 1 from room_photo_uploads where actor_id=p_user_id
    and kind='doll' and committed_date=local_day)
    then return jsonb_build_object('error','daily_limit_reached'); end if;
  insert into room_photos(pair_low,pair_high,owner_id,kind,private_path,updated_by)
    values(p_user_id,p_user_id,p_user_id,ticket.kind,ticket.private_path,p_user_id)
    on conflict(pair_low,pair_high,owner_id,kind) do update set private_path=excluded.private_path,
      updated_by=p_user_id,updated_at=now() returning id into photo_id;
  update room_photo_uploads set committed_at=now(),committed_date=local_day where id=ticket.id;
  insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(p_user_id,p_user_id,p_user_id,p_user_id,'room_media_updated','room_photo',photo_id::text,
      jsonb_build_object('kind',ticket.kind),'room-photo:'||ticket.id::text);
  return jsonb_build_object('error',null,'applied',true,'photoId',photo_id);
end $$;

create or replace function public.solo_burrow_read_photo_v1(p_user_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare path text;
begin
  select private_path into path from room_photos where id=p_photo_id and pair_low=p_user_id
    and pair_high=p_user_id and owner_id=p_user_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('error',null,'path',path);
end $$;

revoke all on function public.solo_burrow_prepare_photo_v1(uuid,uuid,text,uuid,text),
  public.solo_burrow_complete_photo_v1(uuid,uuid),public.solo_burrow_read_photo_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.solo_burrow_prepare_photo_v1(uuid,uuid,text,uuid,text),
  public.solo_burrow_complete_photo_v1(uuid,uuid),public.solo_burrow_read_photo_v1(uuid,uuid)
  to service_role;
notify pgrst,'reload schema';
