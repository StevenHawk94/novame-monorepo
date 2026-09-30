-- A personal memory album is usable before a partner is connected. Preserve
-- the existing digest-bound upload ticket and optimistic slot replacement.
create function public.solo_burrow_prepare_memory_photo_v1(
  p_user_id uuid,p_entry_id uuid,p_slot integer,p_expected_id uuid,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket memory_photo_uploads%rowtype; current_id uuid;
begin
  if p_slot is null or p_slot not between 0 and 2 or p_key is null or p_digest is null
    or p_digest !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid_request'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  perform 1 from memory_room_entries where id=p_entry_id and author_id=p_user_id
    and pair_low=p_user_id and pair_high=p_user_id and deleted_at is null for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into ticket from memory_photo_uploads where actor_id=p_user_id and command_key=p_key;
  if found then
    if ticket.partner_id<>p_user_id or ticket.entry_id<>p_entry_id or ticket.slot<>p_slot
      or ticket.digest<>p_digest or ticket.expected_photo_id is distinct from p_expected_id
      then return jsonb_build_object('error','idempotency_conflict'); end if;
    if ticket.status='expired' or (ticket.status='pending' and ticket.created_at<now()-interval '24 hours')
      then return jsonb_build_object('error','upload_expired'); end if;
  else
    select id into current_id from memory_entry_photos where entry_id=p_entry_id and slot=p_slot;
    if current_id is distinct from p_expected_id then return jsonb_build_object('error','photo_conflict'); end if;
    insert into memory_photo_uploads(actor_id,partner_id,entry_id,slot,expected_photo_id,command_key,digest,private_path)
      values(p_user_id,p_user_id,p_entry_id,p_slot,p_expected_id,p_key,p_digest,
        p_user_id::text||'/'||gen_random_uuid()::text||'.jpg') returning * into ticket;
  end if;
  return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,
    'committed',ticket.status='committed');
end $$;

create function public.solo_burrow_complete_memory_photo_v1(p_user_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket memory_photo_uploads%rowtype; current_id uuid;
begin
  select * into ticket from memory_photo_uploads where id=p_ticket_id and actor_id=p_user_id
    and partner_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  perform 1 from memory_room_entries where id=ticket.entry_id and author_id=p_user_id
    and pair_low=p_user_id and pair_high=p_user_id and deleted_at is null for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if ticket.status='committed' then return jsonb_build_object('error',null,'applied',false); end if;
  if ticket.status='expired' or ticket.created_at<now()-interval '24 hours'
    then return jsonb_build_object('error','upload_expired'); end if;
  select id into current_id from memory_entry_photos where entry_id=ticket.entry_id and slot=ticket.slot;
  if current_id is distinct from ticket.expected_photo_id then return jsonb_build_object('error','photo_conflict'); end if;
  delete from memory_entry_photos where entry_id=ticket.entry_id and slot=ticket.slot;
  insert into memory_entry_photos(id,entry_id,slot,private_path)
    values(ticket.id,ticket.entry_id,ticket.slot,ticket.private_path);
  update memory_photo_uploads set status='committed' where id=ticket.id;
  return jsonb_build_object('error',null,'applied',true);
end $$;

create function public.solo_burrow_read_memory_photo_v1(p_user_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare path text;
begin
  select p.private_path into path from memory_entry_photos p
    join memory_room_entries e on e.id=p.entry_id where p.id=p_photo_id and e.deleted_at is null
    and e.author_id=p_user_id and e.pair_low=p_user_id and e.pair_high=p_user_id;
  if path is null then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('error',null,'path',path);
end $$;

create function public.solo_burrow_delete_memory_photo_v1(p_user_id uuid,p_entry_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare old_slot integer; removed integer;
begin
  perform 1 from memory_room_entries where id=p_entry_id and author_id=p_user_id
    and pair_low=p_user_id and pair_high=p_user_id and deleted_at is null for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select slot into old_slot from memory_entry_photos where id=p_photo_id and entry_id=p_entry_id;
  with retired as (update memory_photo_uploads set status='expired'
    where entry_id=p_entry_id and slot=old_slot and status='pending' returning private_path)
    insert into memory_photo_garbage(private_path) select private_path from retired on conflict do nothing;
  delete from memory_entry_photos where id=p_photo_id and entry_id=p_entry_id;
  get diagnostics removed=row_count;
  return jsonb_build_object('error',null,'applied',removed>0);
end $$;

revoke all on function public.solo_burrow_prepare_memory_photo_v1(uuid,uuid,integer,uuid,uuid,text),
  public.solo_burrow_complete_memory_photo_v1(uuid,uuid),
  public.solo_burrow_read_memory_photo_v1(uuid,uuid),
  public.solo_burrow_delete_memory_photo_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.solo_burrow_prepare_memory_photo_v1(uuid,uuid,integer,uuid,uuid,text),
  public.solo_burrow_complete_memory_photo_v1(uuid,uuid),
  public.solo_burrow_read_memory_photo_v1(uuid,uuid),
  public.solo_burrow_delete_memory_photo_v1(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
