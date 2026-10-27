-- Approved Touch Note v2. No wallet/inventory/subscription writes.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
create index plushie_touch_pair_history on public.plushie_touch_messages
 (pair_version,least(sender_id,recipient_id),greatest(sender_id,recipient_id),created_at desc,id desc);
alter function public.valid_plushie_touch_clip_v1(jsonb) rename to valid_plushie_touch_clip_legacy_v1;
create function public.valid_plushie_touch_clip_v2(c jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare e jsonb;t int;k int;p int;x int;y int;previous int:=-1;n int:=0;held boolean[]:=array[false,false];next_tick int:=-1;steps int;begin
 if c->'version'='1'::jsonb then return valid_plushie_touch_clip_legacy_v1(c);end if;
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>4 or c->'version' is distinct from '2'::jsonb
  or c->'durationMs' is distinct from '60000'::jsonb or jsonb_typeof(c->'events') is distinct from 'array'
  or jsonb_array_length(c->'events') not between 1 and 8192 or octet_length(c::text)>262144
  or jsonb_typeof(c->'touches') is distinct from 'number' or c->>'touches'!~'^[0-9]{1,3}$' or (c->>'touches')::int not between 1 and 999 then return false;end if;
 for e in select value from jsonb_array_elements(c->'events') loop
  if jsonb_typeof(e)<>'array' or jsonb_array_length(e)<>5 or exists(select 1 from jsonb_array_elements(e) v where jsonb_typeof(v)<>'number' or v::text!~'^-?[0-9]{1,6}$') then return false;end if;
  t:=(e->>0)::int;k:=(e->>1)::int;p:=(e->>2)::int;x:=(e->>3)::int;y:=(e->>4)::int;
  if t<previous or t not between 0 and 60000 or k not between 0 and 5 or p not between 0 and 1 or x not between -1000 and 2000 or y not between -1000 and 2000 then return false;end if;
  if t=60000 and(k=0 or k>=4) then return false;end if;
  if previous=-1 and(t<>0 or k not in(0,4,5)) then return false;end if;previous:=t;
  if (held[1] or held[2]) and next_tick>=0 and next_tick<=least(t,59999) then
   steps:=((least(t,59999)-next_tick)/500)+1;n:=least(999,n+steps);next_tick:=next_tick+steps*500;
  end if;
  if k=0 then
   if held[p+1] or x not between 0 and 1000 or y not between 0 and 1000 then return false;end if;
   if not held[1] and not held[2] then n:=least(999,n+1);next_tick:=t+500;end if;held[p+1]:=true;
  elsif k<4 then
   if not held[p+1] then return false;end if;
   if k>=2 then held[p+1]:=false;if not held[1] and not held[2] then next_tick:=-1;end if;end if;
  else if p<>0 or x<>0 or y<>0 then return false;end if;n:=least(999,n+1);end if;
 end loop;
 return not held[1] and not held[2] and n=(c->>'touches')::int;
exception when others then return false;end $$;
-- Existing financial send transaction/keys stay authoritative and unchanged.
create function public.valid_plushie_touch_clip_v1(c jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$select valid_plushie_touch_clip_v2(c)$$;

create or replace function public.prune_plushie_touch_v1(p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;pv text;begin
 partner:=lock_burrow_pair(p_user);if partner is null then return;end if;pv:=burrow_pair_version_v1(p_user,partner);
 perform pg_advisory_xact_lock(hashtextextended('plushie-touch:'||least(p_user,partner)::text,0));
 perform pg_advisory_xact_lock(hashtextextended('plushie-touch:'||greatest(p_user,partner)::text,0));
 if burrow_has_plus_v1(p_user) and same_economic_domain_v1(p_user,partner) then
  delete from plushie_touch_messages where pair_version=pv and least(sender_id,recipient_id)=least(p_user,partner)
   and greatest(sender_id,recipient_id)=greatest(p_user,partner) and id not in
   (select id from plushie_touch_messages where pair_version=pv and least(sender_id,recipient_id)=least(p_user,partner)
    and greatest(sender_id,recipient_id)=greatest(p_user,partner) order by created_at desc,id desc limit 10);
 else
  -- One incoming message EACH, not one shared slot. Never restore pruned data.
  delete from plushie_touch_messages m where pair_version=pv and least(sender_id,recipient_id)=least(p_user,partner)
   and greatest(sender_id,recipient_id)=greatest(p_user,partner) and id not in
   (select distinct on(recipient_id) id from plushie_touch_messages where pair_version=pv
    and least(sender_id,recipient_id)=least(p_user,partner) and greatest(sender_id,recipient_id)=greatest(p_user,partner)
    order by recipient_id,created_at desc,id desc);
 end if;
 update plushie_touch_messages set expires_at=null where pair_version=pv and least(sender_id,recipient_id)=least(p_user,partner)
  and greatest(sender_id,recipient_id)=greatest(p_user,partner) and expires_at is not null;
end $$;

create function public.plushie_touch_state_v2(p_user uuid,p_pair text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;plus boolean;day date;used int;begin
 partner:=lock_burrow_pair(p_user);if partner is null or burrow_pair_version_v1(p_user,partner) is distinct from p_pair then return jsonb_build_object('error','pair_changed');end if;
 perform prune_plushie_touch_v1(p_user);
 plus:=burrow_has_plus_v1(p_user) and same_economic_domain_v1(p_user,partner);
 day:=(now() at time zone economic_timezone_v1(p_user))::date;
 select count(*) into used from plushie_touch_sends where user_id=p_user and
  (case when plus then local_date=day else date_trunc('month',local_date::timestamp)=date_trunc('month',day::timestamp) end);
 return jsonb_build_object('version',2,'userId',p_user,'partnerId',partner,'pairVersion',p_pair,'serverNow',clock_timestamp(),
  'localDate',day,'hasPlus',plus,'remaining',greatest(0,1-used),'sameDomain',same_economic_domain_v1(p_user,partner),
  'items',coalesce((select jsonb_agg(v order by created_at desc,id desc) from
  (select m.id,m.sender_id,m.recipient_id,m.pair_version,m.toy_id,m.created_at,m.expires_at,m.read_at,
   (m.clip->>'touches')::int touches,(m.clip->>'version')::int clip_version,m.asset_snapshot toy
   from plushie_touch_messages m where m.pair_version=p_pair and
   ((m.recipient_id=p_user and m.sender_id=partner) or (plus and m.sender_id=p_user and m.recipient_id=partner))
   order by m.created_at desc,m.id desc limit 10)v),'[]'::jsonb));
end $$;

-- Old devices only see old clips they can decode, and keep the same locking
-- order as v2 sends/reads (never take the higher user's advisory lock first).
create or replace function public.plushie_touch_state_v1(p_user uuid,p_pair text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare state jsonb;begin
 state:=plushie_touch_state_v2(p_user,p_pair);if state?'error' then return state;end if;
 return state||jsonb_build_object('version',1,'items',coalesce((select jsonb_agg(v) from jsonb_array_elements(state->'items') v
  where v->>'recipient_id'=p_user::text and v->>'clip_version'='1'),'[]'::jsonb));
end $$;

create function public.read_plushie_touch_v2(p_user uuid,p_pair text,p_id uuid,p_seen boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;m plushie_touch_messages%rowtype;photo jsonb;begin
 partner:=lock_burrow_pair(p_user);if partner is null or burrow_pair_version_v1(p_user,partner) is distinct from p_pair then return jsonb_build_object('error','pair_changed');end if;
 perform prune_plushie_touch_v1(p_user);
 select * into m from plushie_touch_messages where id=p_id and pair_version=p_pair and
  ((recipient_id=p_user and sender_id=partner) or (sender_id=p_user and recipient_id=partner and burrow_has_plus_v1(p_user) and same_economic_domain_v1(p_user,partner)));
 if not found then return jsonb_build_object('error','not_found');end if;
 -- Sender preview must NEVER consume the recipient's unread fact.
 if p_seen and m.recipient_id=p_user then update plushie_touch_messages set read_at=coalesce(read_at,now()) where id=m.id;m.read_at:=coalesce(m.read_at,now());end if;
 select jsonb_build_object('id',id,'ownerId',owner_id,'kind',kind,'toyId',toy_id,'updatedAt',updated_at) into photo from room_photos
  where id=m.photo_id and owner_id=m.sender_id and toy_id=m.toy_id and kind='doll';
 return jsonb_build_object('version',2,'userId',p_user,'partnerId',partner,'pairVersion',p_pair,'message',
  (to_jsonb(m)-'asset_snapshot'-'photo_id')||jsonb_build_object('toy',m.asset_snapshot,'photo',photo));
end $$;

create or replace function public.read_plushie_touch_v1(p_user uuid,p_pair text,p_id uuid,p_seen boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 result:=read_plushie_touch_v2(p_user,p_pair,p_id,false);if result?'error' then return result;end if;
 if result->'message'->>'recipient_id'<>p_user::text or result->'message'->'clip'->>'version'<>'1' then return jsonb_build_object('error','not_found');end if;
 if p_seen then result:=read_plushie_touch_v2(p_user,p_pair,p_id,true);end if;
 return result||jsonb_build_object('version',1);
end $$;

alter function public.system_notification_context_v1(uuid,text,jsonb) rename to system_notification_context_before_touch_v2;
create function public.system_notification_context_v1(p_user uuid,p_type text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;v int;begin
 result:=system_notification_context_before_touch_v2(p_user,p_type,p_payload);
 if p_type='plushie_touch' and coalesce((result->>'allowed')::boolean,false) then
  select (clip->>'version')::int into v from plushie_touch_messages where id=(p_payload->>'messageId')::uuid and recipient_id=p_user;
  return result||jsonb_build_object('touchVersion',v);
 end if;return result;
end $$;

create or replace function public.cleanup_plushie_touch_v1() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid;n int:=0;before_count int;after_count int;begin
 -- Only select pairs that need work; healthy low-UUID pairs cannot starve
 -- later pairs. No full-table DELETE or 30-day expiry of retained notes.
 for u in select distinct recipient_id from
  (select m.*,row_number() over(partition by pair_version,least(sender_id,recipient_id),greatest(sender_id,recipient_id) order by created_at desc,id desc) shared_rank,
   row_number() over(partition by pair_version,sender_id,recipient_id order by created_at desc,id desc) incoming_rank from plushie_touch_messages m)v
  where expires_at is not null or case when burrow_has_plus_v1(recipient_id) and same_economic_domain_v1(sender_id,recipient_id) then shared_rank>10 else incoming_rank>1 end limit 100
 loop
  select count(*) into before_count from plushie_touch_messages where recipient_id=u or sender_id=u;
  perform prune_plushie_touch_v1(u);
  select count(*) into after_count from plushie_touch_messages where recipient_id=u or sender_id=u;n:=n+before_count-after_count;
 end loop;return n;
end $$;
revoke all on function valid_plushie_touch_clip_v2(jsonb),valid_plushie_touch_clip_v1(jsonb),valid_plushie_touch_clip_legacy_v1(jsonb),
 plushie_touch_state_v2(uuid,text),read_plushie_touch_v2(uuid,text,uuid,boolean),system_notification_context_before_touch_v2(uuid,text,jsonb),system_notification_context_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function plushie_touch_state_v2(uuid,text),read_plushie_touch_v2(uuid,text,uuid,boolean),system_notification_context_v1(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
