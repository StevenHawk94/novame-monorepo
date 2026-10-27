-- Reconnecting the same two accounts starts a new relationship, not an
-- authorization grant over their former relationship. Keep historical rows
-- and personal property. Backfill only provably current legacy history, then
-- bind all new rows to the reciprocal pairing's exact generation.
begin;
create function public.burrow_relation_started_at_v1(p_low uuid,p_high uuid)
returns timestamptz language sql stable security definer set search_path=public as $$
  select case when p_low=p_high then '-infinity'::timestamptz else (
    select greatest(a.created_at,b.created_at) from pairings a join pairings b
      on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id
      where a.user_id=p_low and b.user_id=p_high
  ) end;
$$;
revoke all on function public.burrow_relation_started_at_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_relation_started_at_v1(uuid,uuid) to service_role;

-- New rows are bound to the exact relationship generation, including two
-- successive pairings with the same partner within the same transaction.
create function public.burrow_relation_row_matches_v1(p_low uuid,p_high uuid,p_version text)
returns boolean language sql stable security definer set search_path=public as $$
  select p_low=p_high or (p_version is not null
    and burrow_relation_started_at_v1(p_low,p_high) is not null
    and p_version=burrow_pair_version_v1(p_low,p_high));
$$;
revoke all on function public.burrow_relation_row_matches_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.burrow_relation_row_matches_v1(uuid,uuid,text) to service_role;
create function public.stamp_burrow_relation_row_v1() returns trigger
language plpgsql security definer set search_path=public as $$
declare lo uuid; hi uuid; row_data jsonb;
begin
  row_data:=to_jsonb(new);
  lo:=least(coalesce((row_data->>'pair_low')::uuid,(row_data->>'sender_id')::uuid),
    coalesce((row_data->>'pair_high')::uuid,(row_data->>'recipient_id')::uuid));
  hi:=greatest(coalesce((row_data->>'pair_low')::uuid,(row_data->>'sender_id')::uuid),
    coalesce((row_data->>'pair_high')::uuid,(row_data->>'recipient_id')::uuid));
  new.pair_version:=case when lo<>hi and burrow_relation_started_at_v1(lo,hi) is not null
    then burrow_pair_version_v1(lo,hi) end;
  if tg_table_name='shared_room_state' and tg_op='UPDATE' then
    if old.pair_version is distinct from new.pair_version then
      -- A new sleep command may reuse the pair's singleton row. Preserve only
      -- the current actor's requested state, never the former partner's state.
      new.low_sleeping:=case when new.updated_by=lo then new.low_sleeping else false end;
      new.high_sleeping:=case when new.updated_by=hi then new.high_sleeping else false end;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.stamp_burrow_relation_row_v1() from public,anon,authenticated;
do $$ declare tab text; predicate text; begin
  foreach tab in array array['memory_room_entries','moment_events','gifts','affection_events','shared_room_state','room_loadouts'] loop
    execute format('alter table public.%I add column pair_version text',tab);
    predicate:=case when tab in('gifts','affection_events')
      then 'least(sender_id,recipient_id),greatest(sender_id,recipient_id)' else 'pair_low,pair_high' end;
    -- Preserve active relationships' existing history, not records from a
    -- previously ended epoch. Ambiguous/missing reciprocal rows stay hidden.
    execute format('update public.%I set pair_version=public.burrow_pair_version_v1(%s)
      where %I>=public.burrow_relation_started_at_v1(%s)',tab,predicate,
      case when tab='affection_events' then 'completed_at' when tab in('shared_room_state','room_loadouts') then 'updated_at' else 'created_at' end,predicate);
    execute format('create trigger burrow_relation_stamp before insert %s on public.%I
      for each row execute function public.stamp_burrow_relation_row_v1()',
      case when tab in('shared_room_state','room_loadouts') then 'or update' else '' end,tab);
  end loop;
end $$;

-- Preserve every existing bootstrap feature, including personal wallets,
-- inventory, photo quotas, adventures and daily-use limits.
alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_pre_relation_scope_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; partner uuid; field text; tab text; filtered jsonb;
begin
  partner:=lock_burrow_pair(p_user_id);
  result:=burrow_bootstrap_pre_relation_scope_v1(p_user_id);
  if result->>'error' is not null or partner is null then return result; end if;
  foreach field in array array['memoryEntries','moments','gifts','affectionInbox'] loop
    tab:=case field when 'memoryEntries' then 'memory_room_entries' when 'moments' then 'moment_events'
      when 'gifts' then 'gifts' else 'affection_events' end;
    execute format('select coalesce(jsonb_agg(row_data order by position),''[]''::jsonb)
      from jsonb_array_elements($1) with ordinality as rows(row_data,position)
      where exists(select 1 from public.%I t where t.id=(row_data->>''id'')::uuid
        and public.burrow_relation_row_matches_v1($2,$3,t.pair_version))',tab)
      into filtered using coalesce(result->field,'[]'::jsonb),least(p_user_id,partner),greatest(p_user_id,partner);
    result:=jsonb_set(result,array[field],filtered);
  end loop;
  result:=jsonb_set(result,'{unread,affection}',to_jsonb((select count(*) from affection_events
    where recipient_id=p_user_id and sender_id=partner and read_at is null
      and burrow_relation_row_matches_v1(least(p_user_id,partner),greatest(p_user_id,partner),pair_version))));
  result:=jsonb_set(result,'{unread,gifts}',to_jsonb((select count(*) from gifts
    where recipient_id=p_user_id and sender_id=partner and status='pending'
      and burrow_relation_row_matches_v1(least(p_user_id,partner),greatest(p_user_id,partner),pair_version))));
  result:=jsonb_set(result,'{loadouts}',coalesce((select jsonb_agg(row_data order by position)
    from jsonb_array_elements(coalesce(result->'loadouts','[]'::jsonb)) with ordinality as rows(row_data,position)
    where row_data->>'room_type'='home' or exists(select 1 from room_loadouts t
      where t.id=(row_data->>'id')::uuid and burrow_relation_row_matches_v1(t.pair_low,t.pair_high,t.pair_version))),'[]'::jsonb));
  if not exists(select 1 from shared_room_state where pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner)
    and burrow_relation_row_matches_v1(pair_low,pair_high,pair_version)) then
    result:=jsonb_set(result,'{sharedRoom}','{"mySleeping":false,"partnerSleeping":false,"updatedBy":null,"updatedAt":null,"decoratedBy":null}'::jsonb);
  end if;
  result:=jsonb_set(result,'{sharedRoom,decoratedBy}',coalesce((select to_jsonb(updated_by) from room_loadouts
    where room_type='our' and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner)
      and burrow_relation_row_matches_v1(pair_low,pair_high,pair_version) order by updated_at desc limit 1),'null'::jsonb));
  return result;
end $$;
revoke all on function public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.burrow_bootstrap_v1(uuid) to service_role;

-- Add an epoch predicate inside the authoritative reads, BEFORE pagination.
-- Also guard direct old entry/photo URLs and edit/delete commands. Existing
-- locks, receipts, sharing/privacy filters and solo authorization stay intact.
do $$ declare signature regprocedure; original text; revised text; name text;
begin
  foreach name in array array['burrow_history_v1','burrow_moment_detail_v1',
    'save_memory_room_entry_v1','delete_memory_room_entry_v1','save_memory_room_durable_v1',
    'prepare_memory_photo_v1','complete_memory_photo_v1','read_memory_photo_v1','delete_memory_photo_v1'] loop
    for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=name loop
      original:=pg_get_functiondef(signature);revised:=original;
      revised:=replace(revised,'from moment_events where pair_low=lo and pair_high=hi',
        'from moment_events where public.burrow_relation_row_matches_v1(pair_low,pair_high,pair_version) and pair_low=lo and pair_high=hi');
      revised:=replace(revised,'from memory_room_entries e where ',
        'from memory_room_entries e where public.burrow_relation_row_matches_v1(e.pair_low,e.pair_high,e.pair_version) and ');
      revised:=replace(revised,'from memory_room_entries where ',
        'from memory_room_entries where public.burrow_relation_row_matches_v1(pair_low,pair_high,pair_version) and ');
      revised:=replace(revised,'where id=p_entry_id and author_id=p_user_id',
        'where public.burrow_relation_row_matches_v1(pair_low,pair_high,pair_version) and id=p_entry_id and author_id=p_user_id');
      revised:=replace(revised,'where p.id=p_photo_id and e.deleted_at is null',
        'where p.id=p_photo_id and public.burrow_relation_row_matches_v1(e.pair_low,e.pair_high,e.pair_version) and e.deleted_at is null');
      revised:=replace(revised,'from moment_events where id=p_event_id',
        'from moment_events where public.burrow_relation_row_matches_v1(pair_low,pair_high,pair_version) and id=p_event_id');
      if revised=original then raise exception 'Unrecognized relationship-scope function: %',signature; end if;
      execute revised;
    end loop;
  end loop;
end $$;

-- A previously addressed gift must not be resurrected through its UUID after
-- reconnecting. Personal acquired inventory and purchase receipts are untouched.
alter function public.claim_gift_v1(uuid,uuid) rename to claim_gift_pre_relation_scope_v1;
create function public.claim_gift_v1(p_recipient_id uuid,p_gift_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
  partner:=lock_burrow_pair(p_recipient_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if not exists(select 1 from gifts where id=p_gift_id and recipient_id=p_recipient_id and sender_id=partner
    and burrow_relation_row_matches_v1(least(p_recipient_id,partner),greatest(p_recipient_id,partner),pair_version))
    then return jsonb_build_object('error','not_found'); end if;
  return claim_gift_pre_relation_scope_v1(p_recipient_id,p_gift_id);
end $$;
revoke all on function public.claim_gift_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_gift_v1(uuid,uuid) to service_role;

-- Authenticated direct reads follow the same epoch restriction as service
-- routes. The Boolean policy helper reveals nothing to non-members.
create function public.burrow_can_read_relation_row_v1(p_low uuid,p_high uuid,p_version text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_read_burrow_pair(p_low,p_high)
    and public.burrow_relation_row_matches_v1(p_low,p_high,p_version);
$$;
revoke all on function public.burrow_can_read_relation_row_v1(uuid,uuid,text) from public,anon;
grant execute on function public.burrow_can_read_relation_row_v1(uuid,uuid,text) to authenticated,service_role;
alter policy moments_read_pair on public.moment_events to authenticated
  using (public.burrow_can_read_relation_row_v1(pair_low,pair_high,pair_version)
    and (visibility='pair' or actor_id=auth.uid()));
alter policy memory_entries_read_pair on public.memory_room_entries to authenticated
  using (deleted_at is null and public.burrow_can_read_relation_row_v1(pair_low,pair_high,pair_version));
alter policy affection_read_involved on public.affection_events to authenticated
  using (auth.uid() in(sender_id,recipient_id) and public.burrow_can_read_relation_row_v1(
    least(sender_id,recipient_id),greatest(sender_id,recipient_id),pair_version));
alter policy gifts_read_involved on public.gifts to authenticated
  using (auth.uid() in(sender_id,recipient_id) and public.burrow_can_read_relation_row_v1(
    least(sender_id,recipient_id),greatest(sender_id,recipient_id),pair_version));
alter policy shared_room_state_pair_read on public.shared_room_state to authenticated
  using (public.burrow_can_read_relation_row_v1(pair_low,pair_high,pair_version));
alter policy room_loadouts_read_pair on public.room_loadouts to authenticated
  using ((room_type='home' and public.is_self_or_current_partner(owner_id))
    or (room_type='our' and public.burrow_can_read_relation_row_v1(pair_low,pair_high,pair_version)));
notify pgrst,'reload schema';
commit;
