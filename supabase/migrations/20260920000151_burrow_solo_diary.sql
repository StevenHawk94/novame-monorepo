-- Writing an Adventure log is personal. Pairing controls sharing, not saving.
create or replace function public.burrow_record_policy_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; today date; started boolean; paid boolean;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=lock_burrow_pair(p_user_id);
  today:=burrow_record_date_v1(p_user_id);
  if today is null then return jsonb_build_object('error','profile_not_found'); end if;
  select exists(select 1 from adventures where user_id=p_user_id and local_date=today) into started;
  select exists(select 1 from profiles where id in(p_user_id,partner)
    and subscription_tier::text<>'free') into paid;
  return jsonb_build_object('mode','burrow','localDate',today,'canRecord',not started,
    'reason',case when started then 'daily_adventure_used' else null end,
    'hasPlus',paid,'aiLimit',null,'recordLimit',null,
    'reflectsToday',(select count(*) from reflects where user_id=p_user_id and local_date=today),
    'pendingDraftId',(select id from reflect_drafts where user_id=p_user_id and saved_reflect_id is not null
      and finalized_reflect_id is null order by created_at desc,id desc limit 1));
end $$;

-- This is the pre-sharing reservation implementation from migration 131. The
-- only access change is removing its pairing requirement; its date, quota,
-- idempotency and journal-kind checks remain intact.
create or replace function public.begin_saved_reflect_pre_share_v1(
  p_user_id uuid,p_payload jsonb,p_memories jsonb,p_xp integer,p_week text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d reflect_drafts%rowtype; receipt jsonb; staged jsonb; v_kind text;
  v_is_paid boolean:=false;
  v_major boolean:=exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'));
begin
  if v_major then
    perform lock_burrow_pair(p_user_id);
    perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into d from reflect_drafts where user_id=p_user_id
    and idempotency_key=p_payload->>'idempotency_key' for update;
  if found and (d.saved_reflect_id is not null or d.finalized_reflect_id is not null)
    then return jsonb_build_object('draft',to_jsonb(d)); end if;
  if v_major then
    p_payload:=jsonb_set(p_payload,'{local_date}',to_jsonb(burrow_record_date_v1(p_user_id)::text));
    p_xp:=0;
  end if;
  if (p_payload->>'local_date')::date not between (now() at time zone 'UTC')::date-1
    and (now() at time zone 'UTC')::date+1 then return jsonb_build_object('error','invalid_local_date'); end if;
  v_kind:=case when p_payload->>'journal_kind' in('write_freely','tap_your_day','remember_together')
    then p_payload->>'journal_kind'
    when nullif(p_payload->>'friend_user_id','') is not null then 'remember_together'
    when p_payload->>'mode'='prompt' then 'tap_your_day' else 'write_freely' end;
  select coalesce(subscription_tier::text<>'free',false) into v_is_paid from profiles where id=p_user_id;
  if not v_major and not(v_is_paid and v_kind='write_freely') and exists(
    select 1 from daily_journal_slots where user_id=p_user_id
      and local_date=(p_payload->>'local_date')::date and journal_kind=v_kind)
    then return jsonb_build_object('error','journal_kind_used','journal_kind',v_kind); end if;
  if v_major and (v_kind='remember_together' or nullif(p_payload->>'friend_user_id','') is not null)
    then return jsonb_build_object('error','journal_kind_disabled'); end if;
  if d.id is null then
    insert into reflect_drafts(user_id,idempotency_key,prompt_id,body,local_date,mode,source_kit,
      friend_user_id,matches,journal_kind)
    values(p_user_id,p_payload->>'idempotency_key',(p_payload->>'prompt_id')::smallint,
      p_payload->>'body',(p_payload->>'local_date')::date,p_payload->>'mode',
      p_payload->>'source_kit',(p_payload->>'friend_user_id')::uuid,p_payload->'matches',v_kind)
    returning * into d;
  else
    update reflect_drafts set journal_kind=v_kind where id=d.id returning * into d;
  end if;
  if d.friend_user_id is not null and not exists(select 1 from pairings
    where user_id=p_user_id and partner_user_id=d.friend_user_id)
    then return jsonb_build_object('error','pairing_required'); end if;
  update reflect_drafts set friend_user_id=null where id=d.id;
  receipt:=finalize_reflect_draft(p_user_id,d.id,'[]','[]',p_xp,p_week);
  update reflect_drafts set friend_user_id=d.friend_user_id where id=d.id;
  if receipt->>'error' is not null then return receipt; end if;
  update reflects set journal_kind=v_kind,shared_to_friends=false,shared_with_user_id=null
    where id=(receipt->>'reflect_id')::uuid;
  if not v_major and not(v_is_paid and v_kind='write_freely') then
    insert into daily_journal_slots(user_id,local_date,journal_kind,status,draft_id,reflect_id)
    values(p_user_id,(p_payload->>'local_date')::date,v_kind,'in_progress',d.id,(receipt->>'reflect_id')::uuid);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('itemId',m->>'itemId',
    'text',coalesce(p_memories->>(m->>'itemId'),''),'source','ai','visible',true,'edited',false)),'[]')
    into staged from jsonb_array_elements(d.matches) m;
  update reflect_drafts set saved_reflect_id=(receipt->>'reflect_id')::uuid,finalized_reflect_id=null,
    save_receipt=receipt,settlement_memories=staged where id=d.id returning * into d;
  perform edit_reflect_item_memories(p_user_id,d.saved_reflect_id,
    (select coalesce(jsonb_agg(e||'{"visible":false}'::jsonb),'[]')
      from jsonb_array_elements(staged) e));
  return jsonb_build_object('draft',to_jsonb(d));
end $$;

revoke all on function public.burrow_record_policy_v1(uuid),
  public.begin_saved_reflect_pre_share_v1(uuid,jsonb,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.burrow_record_policy_v1(uuid),
  public.begin_saved_reflect_pre_share_v1(uuid,jsonb,jsonb,integer,text) to service_role;
notify pgrst,'reload schema';
