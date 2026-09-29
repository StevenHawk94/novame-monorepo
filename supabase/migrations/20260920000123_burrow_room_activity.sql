-- Shared room sleep and durable friend visits. No NPC visit awards currency.
-- Shared visits use the lower UUID member's profile timezone as one pair-day;
-- this prevents differing phone timezones from creating two shared visits.
create table public.shared_room_state (
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  low_sleeping boolean not null default false,
  high_sleeping boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(pair_low,pair_high),
  check(pair_low<pair_high),
  check(updated_by is null or updated_by in(pair_low,pair_high))
);
alter table public.shared_room_state enable row level security;
create policy shared_room_state_pair_read on public.shared_room_state for select to authenticated
  using(public.can_read_burrow_pair(pair_low,pair_high));
create policy shared_room_state_service on public.shared_room_state for all to service_role using(true) with check(true);
grant select on public.shared_room_state to authenticated;
grant all on public.shared_room_state to service_role;

alter table public.friend_content add column trigger_scene text not null default 'both'
  check(trigger_scene in('adventure','visit','both'));
alter table public.friend_visits
  add column content_snapshot jsonb not null default '{}',
  add column response jsonb,
  add column responded_by uuid references public.profiles(id) on delete set null,
  add column accepted_at timestamptz,
  add column declined_at timestamptz,
  add column reward_item_id text references public.catalog_items(stable_id),
  add column reward_recipient_id uuid references public.profiles(id) on delete set null;
create unique index friend_visits_one_pending on public.friend_visits(pair_low,pair_high)
  where completed_at is null and declined_at is null;

-- Bind placeholder emotional-help stories to real existing Rage Room IDs.
update public.friend_content set rage_monster_id=case rage_monster_id
  when 'shadow_thought' then 'overthinking' when 'noise_cloud' then 'the_spiral'
  when 'worry_guard' then 'the_hollow' else rage_monster_id end where is_placeholder;

insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,
  price,plus_only,tradable,tags,drop_weight,asset,metadata,is_placeholder)
select 'friend_visit_'||slot||'_'||n,'burrow-v1-placeholder','decor',category,
  title||' '||n,'A little thank-you from a visiting friend.',null,false,false,
  array['friend_gift'],0,jsonb_build_object('renderer','native','symbol',slot),
  jsonb_build_object('slot',slot),true
from (values('lamp','lamps','Firefly Lantern'),('poster','posters','Little Story Print'),
  ('vase','vases','Meadow Bouquet')) x(slot,category,title)
cross join generate_series(1,3)n on conflict(stable_id) do nothing;

create or replace function public.set_room_sleep_v1(p_user_id uuid,p_sleeping boolean,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid; hi uuid; prior public.burrow_command_receipts%rowtype; request jsonb; result jsonb;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if p_sleeping is null or nullif(trim(p_key),'') is null or length(p_key)>200
    then return jsonb_build_object('error','invalid_request'); end if;
  lo:=least(p_user_id,partner); hi:=greatest(p_user_id,partner);
  request:=jsonb_build_object('sleeping',p_sleeping,'partner',partner);
  select * into prior from burrow_command_receipts where actor_id=p_user_id and command_key='sleep:'||p_key;
  if found then
    if prior.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
    return prior.response||'{"applied":false}';
  end if;
  insert into shared_room_state(pair_low,pair_high) values(lo,hi) on conflict do nothing;
  update shared_room_state set low_sleeping=case when p_user_id=lo then p_sleeping else low_sleeping end,
    high_sleeping=case when p_user_id=hi then p_sleeping else high_sleeping end,
    updated_by=p_user_id,updated_at=now() where pair_low=lo and pair_high=hi;
  result:=jsonb_build_object('error',null,'applied',true,'sleeping',p_sleeping);
  insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,'sleep:'||p_key,request,result);
  return result;
end $$;

create or replace function public.ensure_friend_visit_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid; hi uuid; tz text; today date; revision text;
  visit public.friend_visits%rowtype; friend text; content public.friend_content%rowtype;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  lo:=least(p_user_id,partner); hi:=greatest(p_user_id,partner);
  select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where id=lo;
  today:=(now() at time zone tz)::date;
  select * into visit from friend_visits where pair_low=lo and pair_high=hi
    and (completed_at is null and declined_at is null or visit_date=today
      or (completed_at at time zone tz)::date=today or (declined_at at time zone tz)::date=today)
    order by created_at desc limit 1;
  if found then return jsonb_build_object('error',null,'visit',to_jsonb(visit),'visitDate',today,'timezone',tz); end if;
  select value into revision from app_config where key='app_major_update_content_revision';
  select f.stable_id into friend from friend_definitions f where f.status='active' and f.revision_id=revision
    and exists(select 1 from content_revisions r where r.id=f.revision_id and r.status='published')
    and exists(select 1 from user_friend_discoveries d where d.friend_id=f.stable_id
      and d.user_id in(lo,hi) and d.interaction_completed_at is not null)
    and exists(select 1 from friend_content c where c.friend_id=f.stable_id and c.status='active' and c.trigger_scene in('visit','both'))
    and not exists(select 1 from friend_visits v where v.pair_low=lo and v.pair_high=hi
      and v.friend_id=f.stable_id and v.created_at>now()-interval '7 days')
    order by md5(lo::text||hi::text||today::text||f.stable_id) limit 1;
  if friend is null then return jsonb_build_object('error',null,'visit',null,'visitDate',today,'timezone',tz); end if;
  select * into content from friend_content where friend_id=friend and status='active' and trigger_scene in('visit','both')
    order by md5(lo::text||today::text||id::text) limit 1;
  insert into friend_visits(pair_low,pair_high,friend_id,host_user_id,visit_date,content_id,content_snapshot)
    values(lo,hi,friend,p_user_id,today,content.id,to_jsonb(content)) returning * into visit;
  return jsonb_build_object('error',null,'visit',to_jsonb(visit),'visitDate',today,'timezone',tz);
end $$;

create or replace function public.respond_friend_visit_v1(p_user_id uuid,p_visit_id uuid,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; visit public.friend_visits%rowtype; kind text; choice text; item text; recipient uuid;
  feedback text; monster text;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  select * into visit from friend_visits where id=p_visit_id and pair_low=least(p_user_id,partner)
    and pair_high=greatest(p_user_id,partner) for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if visit.completed_at is not null or visit.declined_at is not null then
    return jsonb_build_object('error',null,'applied',false,'itemId',visit.reward_item_id,'recipientId',visit.reward_recipient_id);
  end if;
  if p_response is null or jsonb_typeof(p_response)<>'object' then return jsonb_build_object('error','invalid_response'); end if;
  kind:=visit.content_snapshot->>'content_type'; choice:=p_response->>'choiceId';
  if kind='insight' then
    if p_response->'acknowledged' is distinct from 'true'::jsonb then return jsonb_build_object('error','invalid_response'); end if;
  elsif kind in('question','emotional_help') then
    if not exists(select 1 from jsonb_array_elements(visit.content_snapshot->'choices') c where c->>'id'=choice)
      then return jsonb_build_object('error','invalid_response'); end if;
    feedback:=visit.content_snapshot->'feedback'->>choice;
    if kind='emotional_help' then
      if choice='not_now' then
        update friend_visits set declined_at=now(),response=p_response,responded_by=p_user_id where id=p_visit_id;
        return jsonb_build_object('error',null,'applied',true,'declined',true);
      end if;
      if choice<>'yes' then return jsonb_build_object('error','invalid_response'); end if;
      monster:=visit.content_snapshot->>'rage_monster_id';
      if visit.accepted_at is null then
        update friend_visits set accepted_at=now(),response=p_response,responded_by=p_user_id where id=p_visit_id;
        return jsonb_build_object('error',null,'applied',true,'battleRequired',true,'monsterId',monster);
      end if;
      -- A real server-recorded battle AFTER acceptance is required. Merely
      -- navigating to Rage or claiming a client-side success cannot award a gift.
      if not exists(select 1 from kit_completions k where k.user_id in(visit.pair_low,visit.pair_high)
        and k.kit='tame_enemy' and k.payload->>'monster_id'=monster and k.created_at>=visit.accepted_at)
        then return jsonb_build_object('error','battle_required','monsterId',monster); end if;
    end if;
  else return jsonb_build_object('error','invalid_response'); end if;
  -- Gift pool is independent of the shop/adventure pool. Grant to the answering
  -- member first, or the partner if only they lack it. Never mint currency.
  select c.stable_id,case when exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=c.stable_id)
    then partner else p_user_id end into item,recipient
    from catalog_items c where c.status='active' and c.item_type in('decor','outfit','our_room')
    and 'friend_gift'=any(c.tags) and not c.plus_only
    and c.revision_id=(select value from app_config where key='app_major_update_content_revision')
    and exists(select 1 from content_revisions r where r.id=c.revision_id and r.status='published')
    and (not exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=c.stable_id)
      or not exists(select 1 from user_inventory i where i.owner_id=partner and i.item_id=c.stable_id))
    and not exists(select 1 from gifts g where g.item_id=c.stable_id and g.status='pending' and g.recipient_id in(p_user_id,partner))
    and not exists(select 1 from adventure_results ar join adventures a on a.id=ar.adventure_id
      where ar.item_id=c.stable_id and ar.claim_status='pending' and a.user_id in(p_user_id,partner))
    order by md5(p_visit_id::text||c.stable_id) limit 1;
  if item is not null then
    insert into user_inventory(owner_id,item_id,source,source_reference_id) values(recipient,item,'friend_visit',p_visit_id::text);
    insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
      values(visit.pair_low,visit.pair_high,p_user_id,recipient,'gift_claimed','friend_visit',p_visit_id::text,
        jsonb_build_object('itemId',item,'friendId',visit.friend_id,'recipientId',recipient),'friend-visit:'||p_visit_id::text);
  end if;
  update friend_visits set completed_at=now(),response=p_response,responded_by=p_user_id,
    reward_item_id=item,reward_recipient_id=recipient where id=p_visit_id;
  return jsonb_build_object('error',null,'applied',true,'itemId',item,'recipientId',recipient,'feedback',feedback,'poolExhausted',item is null);
end $$;

-- Compose with the existing transactional bootstrap without duplicating it.
alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_core_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; partner uuid; lo uuid; hi uuid; sleeping public.shared_room_state%rowtype; visits jsonb;
begin
  result:=burrow_bootstrap_core_v1(p_user_id);
  if result->>'error' is not null then return result; end if;
  partner:=(result->'partner'->>'id')::uuid; lo:=least(p_user_id,partner); hi:=greatest(p_user_id,partner);
  select * into sleeping from shared_room_state where pair_low=lo and pair_high=hi;
  visits:=ensure_friend_visit_v1(p_user_id);
  return result||jsonb_build_object('sharedRoom',jsonb_build_object(
    'mySleeping',coalesce(case when p_user_id=lo then sleeping.low_sleeping else sleeping.high_sleeping end,false),
    'partnerSleeping',coalesce(case when p_user_id=lo then sleeping.high_sleeping else sleeping.low_sleeping end,false),
    'updatedBy',sleeping.updated_by,'updatedAt',sleeping.updated_at,
    'decoratedBy',(select updated_by from room_loadouts where room_type='our' and pair_low=lo and pair_high=hi order by updated_at desc limit 1)),
    'friendVisit',visits->'visit','friendVisitDate',visits->'visitDate','friendVisitTimezone',visits->'timezone');
end $$;

revoke all on function public.set_room_sleep_v1(uuid,boolean,text),public.ensure_friend_visit_v1(uuid),
  public.respond_friend_visit_v1(uuid,uuid,jsonb),public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.set_room_sleep_v1(uuid,boolean,text),public.ensure_friend_visit_v1(uuid),
  public.respond_friend_visit_v1(uuid,uuid,jsonb),public.burrow_bootstrap_v1(uuid) to service_role;
notify pgrst,'reload schema';
