-- Personal history can paginate without a connection. Pair history retains
-- its existing locked-pair authorization and never falls back to solo data.
create or replace function public.burrow_moment_record_v1(p_viewer uuid,p_reference text,p_low uuid,p_high uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if p_low=p_viewer and p_high=p_viewer then
    -- Solo records never enter the shared-record table. Only their owner may
    -- resolve their text; pairing later must not grant a partner access.
    select jsonb_build_object('id',r.id,'body',r.body,'shared',false,'items',
      coalesce((select jsonb_agg(jsonb_build_object('itemId',i.item_id,
        'label',coalesce(to_jsonb(i)->>'match_label',i.item_id)) order by i.item_id)
        from reflect_items i where i.reflect_id=r.id and i.user_id=p_viewer),'[]')) into result
      from reflects r where r.id::text=p_reference and r.user_id=p_viewer;
    return result;
  end if;
  return burrow_shared_record_v1(p_viewer,p_reference,p_low,p_high);
end $$;
revoke all on function public.burrow_moment_record_v1(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_moment_record_v1(uuid,text,uuid,uuid) to service_role;
create or replace function public.solo_burrow_history_v1(
  p_user_id uuid,p_kind text,p_before timestamptz default null,
  p_before_id uuid default null,p_date date default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare tz text; rows jsonb; last_row jsonb; more boolean;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  if lock_burrow_pair(p_user_id) is not null then return jsonb_build_object('error','pair_changed'); end if;
  if p_kind is null or p_kind not in('moments','memories') or (p_before is null)<>(p_before_id is null)
    then return jsonb_build_object('error','invalid_request'); end if;
  select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where id=p_user_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if p_kind='moments' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]') into rows from (
      select id,actor_id,event_type,reference_id,reference_type,created_at,payload,
        case when reference_type='reflect' then burrow_moment_record_v1(p_user_id,reference_id,p_user_id,p_user_id) end as record,
        (created_at at time zone tz)::date as "localDate"
      from moment_events where pair_low=p_user_id and pair_high=p_user_id and actor_id=p_user_id
        and (p_before is null or (created_at,id)<(p_before,p_before_id))
        and (p_date is null or (created_at at time zone tz)::date=p_date)
      order by created_at desc,id desc limit 31
    ) r;
  else
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]') into rows from (
      select e.id,e.author_id,e.body,e.prompt_id,e.created_at,e.updated_at,
        (e.created_at at time zone tz)::date as "localDate",
        coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slot',p.slot,'updatedAt',p.updated_at) order by p.slot)
          from memory_entry_photos p where p.entry_id=e.id),'[]') as photos
      from memory_room_entries e where pair_low=p_user_id and pair_high=p_user_id and author_id=p_user_id and deleted_at is null
        and (p_before is null or (e.created_at,e.id)<(p_before,p_before_id))
        and (p_date is null or (e.created_at at time zone tz)::date=p_date)
      order by e.created_at desc,e.id desc limit 31
    ) r;
  end if;
  more:=jsonb_array_length(rows)>30;
  if more then rows:=rows-30; end if;
  last_row:=rows->(jsonb_array_length(rows)-1);
  return jsonb_build_object('rows',rows,'hasMore',more,'timezone',tz,
    'next',case when more then jsonb_build_object('at',last_row->>'created_at','id',last_row->>'id') else null end);
end $$;
revoke all on function public.solo_burrow_history_v1(uuid,text,timestamptz,uuid,date) from public,anon,authenticated;
grant execute on function public.solo_burrow_history_v1(uuid,text,timestamptz,uuid,date) to service_role;
-- Record an answer only after its insert commits; edits do not create another
-- completion event. Never emit events for merely opening Today's page.
create or replace function public.couple_journal_moment_v1() returns trigger
language plpgsql security definer set search_path=public as $$
declare page couple_journal_pages%rowtype;
begin
  select * into page from couple_journal_pages where id=new.page_id;
  insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
    values(page.pair_low,page.pair_high,new.author_id,
      case when new.author_id=page.pair_low then page.pair_high else page.pair_low end,
      'memory_created','couple_journal_page',page.id::text,
      jsonb_build_object('journalKind','couple_journal','question',
        (select prompt from couple_journal_questions where id=page.question_id)),
      'couple-journal:'||page.id::text||':'||new.author_id::text)
    on conflict(actor_id,idempotency_key) do nothing;
  return new;
end $$;
revoke all on function public.couple_journal_moment_v1() from public,anon,authenticated;
drop trigger if exists couple_journal_answer_moment on public.couple_journal_answers;
create trigger couple_journal_answer_moment after insert on public.couple_journal_answers
  for each row execute function public.couple_journal_moment_v1();

-- The event's exact reference is resolved inside the authorization transaction.
-- A UUID in a link is never authority to read a previous partner's record.
create or replace function public.burrow_moment_detail_v1(p_user_id uuid,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid; hi uuid; event moment_events%rowtype;
  journal couple_journal_pages%rowtype; memory memory_room_entries%rowtype;
  content jsonb; entry jsonb; journal_page jsonb;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=lock_burrow_pair(p_user_id);
  lo:=least(p_user_id,coalesce(partner,p_user_id)); hi:=greatest(p_user_id,coalesce(partner,p_user_id));
  select * into event from moment_events where id=p_event_id
    and ((pair_low=lo and pair_high=hi) or (pair_low=p_user_id and pair_high=p_user_id and actor_id=p_user_id))
    and (visibility='pair' or actor_id=p_user_id);
  if not found then return jsonb_build_object('error','not_found'); end if;
  if event.reference_type='reflect' then
    content:=burrow_moment_record_v1(p_user_id,event.reference_id,event.pair_low,event.pair_high);
    if content is null then return jsonb_build_object('error','not_found'); end if;
  elsif event.reference_type='memory_room_entry' then
    select * into memory from memory_room_entries where id::text=event.reference_id
      and pair_low=event.pair_low and pair_high=event.pair_high and deleted_at is null;
    if not found then return jsonb_build_object('error','not_found'); end if;
    entry:=jsonb_build_object('id',memory.id,'body',memory.body,'authorId',memory.author_id,'updatedAt',memory.updated_at);
  elsif event.reference_type='couple_journal_page' then
    select * into journal from couple_journal_pages where id::text=event.reference_id;
    if not found then return jsonb_build_object('error','not_found'); end if;
    if not (journal.pair_low=p_user_id and journal.pair_high=p_user_id and journal.pair_version='solo') then
      if partner is null or journal.pair_low<>lo or journal.pair_high<>hi
        or journal.pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
        then return jsonb_build_object('error','pair_changed'); end if;
    end if;
    journal_page:=couple_journal_page_json_v1(journal.id);
  end if;
  return jsonb_build_object('event',to_jsonb(event)-'idempotency_key','record',content,'memory',entry,'page',journal_page);
end $$;
revoke all on function public.burrow_moment_detail_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_moment_detail_v1(uuid,uuid) to service_role;
create or replace function public.read_couple_journal_page_v1(p_user_id uuid,p_page_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; page couple_journal_pages%rowtype;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=lock_burrow_pair(p_user_id);
  select * into page from couple_journal_pages where id=p_page_id;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if not (page.pair_low=p_user_id and page.pair_high=p_user_id and page.pair_version='solo') then
    if partner is null or page.pair_low<>least(p_user_id,partner) or page.pair_high<>greatest(p_user_id,partner)
      or page.pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
      then return jsonb_build_object('error','pair_changed'); end if;
  end if;
  return jsonb_build_object('page',couple_journal_page_json_v1(p_page_id));
end $$;
revoke all on function public.read_couple_journal_page_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_couple_journal_page_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
