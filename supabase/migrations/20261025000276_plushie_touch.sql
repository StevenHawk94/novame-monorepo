-- Touch messages are social data, never a wallet/reward/inventory writer.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
create table public.plushie_touch_messages(
 id uuid primary key default gen_random_uuid(),sender_id uuid not null references profiles on delete cascade,
 recipient_id uuid not null references profiles on delete cascade,pair_version text not null,
 toy_id text not null,asset_snapshot jsonb not null,photo_id uuid references room_photos on delete set null,
 clip jsonb not null,created_at timestamptz not null default clock_timestamp(),expires_at timestamptz,read_at timestamptz,
 check(sender_id<>recipient_id),check(octet_length(clip::text)<=262144)
);
create index plushie_touch_inbox on public.plushie_touch_messages(recipient_id,created_at desc,id desc);
create index plushie_touch_expiry on public.plushie_touch_messages(expires_at) where expires_at is not null;
-- Minimal replay/quota tombstones contain NO gesture payload or private photo.
create table public.plushie_touch_sends(
 user_id uuid not null references profiles on delete cascade,command_key uuid not null,
 local_date date not null,request_hash text not null,receipt jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,command_key)
);
create index plushie_touch_quota on public.plushie_touch_sends(user_id,local_date);
alter table public.plushie_touch_messages enable row level security;
alter table public.plushie_touch_sends enable row level security;
revoke all on public.plushie_touch_messages,public.plushie_touch_sends from public,anon,authenticated;
grant select on public.plushie_touch_messages,public.plushie_touch_sends to service_role;

create function public.valid_plushie_touch_clip_v1(c jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare e jsonb;t int;k int;p int;x int;y int;previous int:=-1;n int:=0;held boolean[]:=array[false,false];begin
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>4 or c->'version' is distinct from '1'::jsonb or c->'durationMs' is distinct from '60000'::jsonb
  or jsonb_typeof(c->'events') is distinct from 'array' or jsonb_array_length(c->'events') not between 1 and 8192
  or octet_length(c::text)>262144 or jsonb_typeof(c->'touches') is distinct from 'number'
  or c->>'touches'!~'^[0-9]{1,3}$' or (c->>'touches')::int not between 1 and 999 then return false;end if;
 for e in select value from jsonb_array_elements(c->'events') loop
  if jsonb_typeof(e)<>'array' or jsonb_array_length(e)<>5 or exists(select 1 from jsonb_array_elements(e) v where jsonb_typeof(v)<>'number' or v::text!~'^-?[0-9]{1,6}$') then return false;end if;
  t:=(e->>0)::int;k:=(e->>1)::int;p:=(e->>2)::int;x:=(e->>3)::int;y:=(e->>4)::int;
  if t<previous or t not between 0 and 60000 or k not between 0 and 5 or p not between 0 and 1
   or x not between -1000 and 2000 or y not between -1000 and 2000 then return false;end if;
  if previous=-1 and(t<>0 or k not in(0,4,5)) then return false;end if;previous:=t;
  if k=0 then
   if held[p+1] or x not between 0 and 1000 or y not between 0 and 1000 then return false;end if;held[p+1]:=true;
  elsif k<4 then
   if not held[p+1] then return false;end if;
   if k>=2 then held[p+1]:=false;if k=2 then n:=n+1;end if;end if;
  else if p<>0 or x<>0 or y<>0 then return false;end if;n:=n+1;end if;
 end loop;
 return not held[1] and not held[2] and n=(c->>'touches')::int;
exception when others then return false;end $$;

create function public.prune_plushie_touch_v1(p_user uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if burrow_has_plus_v1(p_user) then
  delete from plushie_touch_messages where recipient_id=p_user and created_at<=now()-interval '30 days';
 else
  delete from plushie_touch_messages where recipient_id=p_user and id not in
   (select id from plushie_touch_messages where recipient_id=p_user order by created_at desc,id desc limit 1);
 end if;
 delete from plushie_touch_messages where recipient_id=p_user and expires_at<=now();
end $$;

create function public.plushie_touch_state_v1(p_user uuid,p_pair text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;day date;plus boolean;used int;begin
 partner:=lock_burrow_pair(p_user);
 if partner is null or burrow_pair_version_v1(p_user,partner) is distinct from p_pair then return jsonb_build_object('error','pair_changed');end if;
 plus:=burrow_has_plus_v1(p_user);day:=(now() at time zone economic_timezone_v1(p_user))::date;
 perform pg_advisory_xact_lock(hashtextextended('plushie-touch:'||p_user::text,0));perform prune_plushie_touch_v1(p_user);
 select count(*) into used from plushie_touch_sends where user_id=p_user and
  (case when plus then local_date=day else date_trunc('month',local_date::timestamp)=date_trunc('month',day::timestamp) end);
 return jsonb_build_object('version',1,'userId',p_user,'partnerId',partner,'pairVersion',p_pair,'serverNow',clock_timestamp(),
  'localDate',day,'hasPlus',plus,'remaining',greatest(0,1-used),'sameDomain',same_economic_domain_v1(p_user,partner),
  'items',coalesce((select jsonb_agg(to_jsonb(m)-'clip'-'asset_snapshot' order by m.created_at desc,m.id desc)
   from(select * from plushie_touch_messages where recipient_id=p_user and sender_id=partner and pair_version=p_pair order by created_at desc,id desc limit 70)m),'[]'::jsonb));
end $$;

create function public.send_plushie_touch_v1(p_user uuid,p_partner uuid,p_pair text,p_day date,p_key uuid,p_toy text,p_photo uuid,p_clip jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;day date;plus boolean;hash text;old plushie_touch_sends%rowtype;c catalog_items%rowtype;mid uuid;result jsonb;begin
 partner:=lock_burrow_pair(p_user);
 if partner is null or partner is distinct from p_partner or burrow_pair_version_v1(p_user,partner) is distinct from p_pair then return jsonb_build_object('error','pair_changed');end if;
 if not same_economic_domain_v1(p_user,partner) then return jsonb_build_object('error','economic_domain_conflict');end if;
 if p_key is null or p_toy is null or p_photo is null or p_day is null or not coalesce(valid_plushie_touch_clip_v1(p_clip),false) then return jsonb_build_object('error','invalid_request');end if;
 perform pg_advisory_xact_lock(hashtextextended('plushie-touch:'||least(p_user,partner)::text,0));
 perform pg_advisory_xact_lock(hashtextextended('plushie-touch:'||greatest(p_user,partner)::text,0));
 hash:=md5(jsonb_build_array(p_partner,p_pair,p_day,p_toy,p_photo,p_clip)::text);
 select * into old from plushie_touch_sends where user_id=p_user and command_key=p_key;
 if found then
  if old.request_hash<>hash then return jsonb_build_object('error','idempotency_conflict');end if;return old.receipt;
 end if;
 day:=(now() at time zone economic_timezone_v1(p_user))::date;
 if day<>p_day then return jsonb_build_object('error','touch_period_expired');end if;
 plus:=burrow_has_plus_v1(p_user);
 if exists(select 1 from plushie_touch_sends where user_id=p_user and
  (case when plus then local_date=day else date_trunc('month',local_date::timestamp)=date_trunc('month',day::timestamp) end)) then return jsonb_build_object('error','touch_quota_used');end if;
 if not personal_burrow_toy_photo_target_allowed_v1(p_user,p_user,p_toy,partner)
  or not exists(select 1 from room_photos where id=p_photo and owner_id=p_user and kind='doll' and toy_id=p_toy)
  then return jsonb_build_object('error','touch_toy_unavailable');end if;
 select * into strict c from catalog_items where stable_id=p_toy;
 insert into plushie_touch_messages(sender_id,recipient_id,pair_version,toy_id,asset_snapshot,photo_id,clip,expires_at)
 values(p_user,partner,p_pair,p_toy,to_jsonb(c),p_photo,p_clip,case when burrow_has_plus_v1(partner) then now()+interval '30 days' end) returning id into mid;
 perform prune_plushie_touch_v1(partner);
 result:=jsonb_build_object('version',1,'success',true,'messageId',mid);
 insert into plushie_touch_sends(user_id,command_key,local_date,request_hash,receipt) values(p_user,p_key,day,hash,result);
 insert into notification_outbox(recipient_user_id,event_key,event_type,payload,expires_at)
 values(partner,'plushie-touch:'||mid,'plushie_touch',jsonb_build_object('messageId',mid,'senderId',p_user,'pairVersion',p_pair),now()+interval '1 day') on conflict do nothing;
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
  begin perform realtime.send('{}'::jsonb,'plushie_touch_changed','burrow:'||partner::text,true);exception when others then null;end;
 end if;
 return result;
end $$;

create function public.read_plushie_touch_v1(p_user uuid,p_pair text,p_id uuid,p_seen boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;m plushie_touch_messages%rowtype;photo jsonb;begin
 partner:=lock_burrow_pair(p_user);
 if partner is null or burrow_pair_version_v1(p_user,partner) is distinct from p_pair then return jsonb_build_object('error','pair_changed');end if;
 perform pg_advisory_xact_lock(hashtextextended('plushie-touch:'||p_user::text,0));perform prune_plushie_touch_v1(p_user);
 select * into m from plushie_touch_messages where id=p_id and recipient_id=p_user and sender_id=partner and pair_version=p_pair;
 if not found then return jsonb_build_object('error','not_found');end if;
 if p_seen then update plushie_touch_messages set read_at=coalesce(read_at,now()) where id=m.id;m.read_at:=coalesce(m.read_at,now());end if;
 select jsonb_build_object('id',id,'ownerId',owner_id,'kind',kind,'toyId',toy_id,'updatedAt',updated_at) into photo from room_photos
  where id=m.photo_id and owner_id=m.sender_id and toy_id=m.toy_id and kind='doll';
 return jsonb_build_object('version',1,'userId',p_user,'partnerId',partner,'pairVersion',p_pair,'message',
  (to_jsonb(m)-'asset_snapshot'-'photo_id')||jsonb_build_object('toy',m.asset_snapshot,'photo',photo));
end $$;

create function public.clear_plushie_touch_pair_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or old.partner_user_id is distinct from new.partner_user_id then
  delete from plushie_touch_messages where(sender_id=old.user_id and recipient_id=old.partner_user_id)or(sender_id=old.partner_user_id and recipient_id=old.user_id);
  delete from notification_outbox where event_type='plushie_touch' and
   ((recipient_user_id=old.user_id and payload->>'senderId'=old.partner_user_id::text)or(recipient_user_id=old.partner_user_id and payload->>'senderId'=old.user_id::text));
 end if;return null;
end $$;
create trigger plushie_touch_pair_deleted after delete or update of partner_user_id on pairings for each row execute function clear_plushie_touch_pair_v1();

-- A sender may have created this face while solo or equipped a different toy
-- since sending. Only a still-accessible message grants this narrow read; it
-- grants no inventory, room editing or access to unrelated photo history.
create function public.read_plushie_touch_photo_v1(p_user uuid,p_photo uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;path text;begin
 partner:=lock_burrow_pair(p_user);if partner is null then return jsonb_build_object('error','not_found');end if;
 perform pg_advisory_xact_lock(hashtextextended('plushie-touch:'||p_user::text,0));perform prune_plushie_touch_v1(p_user);
 select p.private_path into path from room_photos p where p.id=p_photo and p.owner_id=partner and p.kind='doll' and exists(
  select 1 from plushie_touch_messages m where m.photo_id=p.id and m.toy_id=p.toy_id and m.sender_id=partner
   and m.recipient_id=p_user and m.pair_version=burrow_pair_version_v1(p_user,partner));
 if not found then return jsonb_build_object('error','not_found');end if;
 return jsonb_build_object('error',null,'path',path);
end $$;

create function public.cleanup_plushie_touch_v1() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;begin
 delete from plushie_touch_messages where id in(select id from plushie_touch_messages where expires_at<=now() limit 1000);get diagnostics n=row_count;
 return n;
end $$;
alter table device_push_tokens add column plushie_touch_version integer not null default 0;
alter function public.system_notification_context_v1(uuid,text,jsonb) rename to system_notification_context_before_touch_v1;
create function public.system_notification_context_v1(p_user uuid,p_type text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid;m plushie_touch_messages%rowtype;name text;begin
 if p_type<>'plushie_touch' then return system_notification_context_before_touch_v1(p_user,p_type,p_payload);end if;
 partner:=lock_burrow_pair(p_user);if partner is null then return jsonb_build_object('allowed',false);end if;
 perform prune_plushie_touch_v1(p_user);
 select * into m from plushie_touch_messages where id=(p_payload->>'messageId')::uuid and recipient_id=p_user and sender_id=partner
  and pair_version=burrow_pair_version_v1(p_user,partner) and pair_version=p_payload->>'pairVersion' and read_at is null;
 if not found then return jsonb_build_object('allowed',false);end if;
 select display_name into name from profiles where id=partner;return jsonb_build_object('allowed',true,'partnerName',name);
exception when invalid_text_representation then return jsonb_build_object('allowed',false);
end $$;
revoke all on function valid_plushie_touch_clip_v1(jsonb),prune_plushie_touch_v1(uuid),plushie_touch_state_v1(uuid,text),
 send_plushie_touch_v1(uuid,uuid,text,date,uuid,text,uuid,jsonb),read_plushie_touch_v1(uuid,text,uuid,boolean),clear_plushie_touch_pair_v1(),
 cleanup_plushie_touch_v1(),read_plushie_touch_photo_v1(uuid,uuid),system_notification_context_before_touch_v1(uuid,text,jsonb),system_notification_context_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function plushie_touch_state_v1(uuid,text),send_plushie_touch_v1(uuid,uuid,text,date,uuid,text,uuid,jsonb),
 read_plushie_touch_v1(uuid,text,uuid,boolean),read_plushie_touch_photo_v1(uuid,uuid),cleanup_plushie_touch_v1(),system_notification_context_v1(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
