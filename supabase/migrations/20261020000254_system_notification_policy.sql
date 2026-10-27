-- Notification-only sidecars. Do not replace Adventure, rewards, unread,
-- Moments, Affection or Surprise business functions.
alter table public.device_push_tokens add column notification_version integer not null default 1;
alter table public.device_push_tokens add column adventure_reminder_enabled boolean not null default false;
alter table public.notification_outbox add column expires_at timestamptz;
create table public.system_notification_policy(id boolean primary key default true check(id),activated_at timestamptz not null default now());
insert into public.system_notification_policy(id) values(true);
alter table public.system_notification_policy enable row level security;
revoke all on public.system_notification_policy from public,anon,authenticated;
grant all on public.system_notification_policy to service_role;
create table public.system_notification_sources(kind text not null,id uuid not null,primary key(kind,id));
alter table public.system_notification_sources enable row level security;
revoke all on public.system_notification_sources from public,anon,authenticated;
grant all on public.system_notification_sources to service_role;
create index device_adventure_reminders on public.device_push_tokens(user_id) where enabled and notification_version>=2 and adventure_reminder_enabled;

-- Stop queued legacy notifications, retaining sent history and shared tables.
update public.notification_outbox set status='failed',last_error='notification_retired',locked_at=null
where status in('pending','retry','sending') and (event_type='partner_reflect' or event_type like 'court_%');

create function public.notification_timezone_v1(p_user uuid) returns text
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select p.timezone_name from profiles p join pg_timezone_names z on z.name=p.timezone_name where p.id=p_user),'UTC')
$$;

create function public.enqueue_affection_push_v1(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare item affection_events%rowtype; zone text; day date; version text; first_id uuid; paired_at timestamptz;
begin
 select * into item from affection_events where id=p_id;
 if not found or item.completed_at<(select activated_at from system_notification_policy where id) then return;end if;
 select created_at into paired_at from pairings where user_id=item.recipient_id and partner_user_id=item.sender_id;
 if not found or item.completed_at<paired_at then return;end if;
 version:=burrow_pair_version_v1(item.sender_id,item.recipient_id);
 zone:=notification_timezone_v1(item.recipient_id);day:=(item.completed_at at time zone zone)::date;
 perform pg_advisory_xact_lock(hashtextextended('affection-push:'||item.recipient_id||':'||version||':'||day,0));
 select id into first_id from affection_events where sender_id=item.sender_id and recipient_id=item.recipient_id
  and completed_at>=greatest(day::timestamp at time zone zone,paired_at)
  and completed_at<(day+1)::timestamp at time zone zone order by completed_at,id limit 1;
 if first_id is distinct from p_id then return;end if;
 insert into notification_outbox(recipient_user_id,event_key,event_type,payload,expires_at)
 values(item.recipient_id,'affection-daily:'||version||':'||item.sender_id||':'||day,'affection_received',
  jsonb_build_object('eventId',item.id,'senderId',item.sender_id,'pairVersion',version,'localDate',day),
  (day+1)::timestamp at time zone zone)
 on conflict(recipient_user_id,event_key) do nothing;
end $$;

create function public.enqueue_surprise_push_v1(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare item burrow_surprises%rowtype;
begin
 select * into item from burrow_surprises where id=p_id;
 if not found or item.sent_at is null or item.expired_at is not null
  or item.sent_at<(select activated_at from system_notification_policy where id) then return;end if;
 if not exists(select 1 from pairings where user_id=item.recipient_id and partner_user_id=item.sender_id)
  or item.pair_version is distinct from burrow_pair_version_v1(item.sender_id,item.recipient_id) then return;end if;
 insert into notification_outbox(recipient_user_id,event_key,event_type,payload,expires_at)
 values(item.recipient_id,'surprise-received:'||item.id,'surprise_received',
  jsonb_build_object('surpriseId',item.id,'senderId',item.sender_id,'pairVersion',item.pair_version),item.sent_at+interval '24 hours')
 on conflict(recipient_user_id,event_key) do nothing;
end $$;

create function public.capture_system_notification_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='affection_events' then perform enqueue_affection_push_v1(new.id);
 elsif new.sent_at is not null then perform enqueue_surprise_push_v1(new.id);end if;
 insert into system_notification_sources(kind,id) values(tg_table_name,new.id) on conflict do nothing;
 return new;
exception when others then
 -- A notification failure must not roll back an interaction or paid send.
 -- The bounded repair scan below re-enqueues committed source events.
 raise warning 'system_notification_pending';return new;
end $$;
create trigger affection_system_notification after insert on public.affection_events for each row execute function public.capture_system_notification_v1();
create trigger surprise_system_notification after update of sent_at on public.burrow_surprises for each row
 when(old.sent_at is null and new.sent_at is not null) execute function public.capture_system_notification_v1();

create function public.adventure_reminder_eligible_v1(p_user uuid,p_day date,p_now timestamptz default now()) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select (p_now at time zone notification_timezone_v1(p_user))::date=p_day
  and (p_now at time zone notification_timezone_v1(p_user))::time>=time '20:00'
  and (p_now at time zone notification_timezone_v1(p_user))::time<time '20:15'
  and not exists(select 1 from adventures where user_id=p_user and local_date=p_day and started_at is not null)
  and not exists(select 1 from adventures where user_id=p_user and status in('in_progress','result_ready','interaction_required'))
$$;

create function public.prepare_system_notifications_v1() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare row record; scanned integer:=0; day date; zone text;
begin
 -- Repair only post-rollout, recent source events. Never notify historic data.
 for row in select id from affection_events where completed_at>=greatest(now()-interval '24 hours',(select activated_at from system_notification_policy where id))
  and not exists(select 1 from system_notification_sources where kind='affection_events' and system_notification_sources.id=affection_events.id)
  order by completed_at limit 200 loop
   perform enqueue_affection_push_v1(row.id);insert into system_notification_sources values('affection_events',row.id) on conflict do nothing;
  end loop;
 for row in select id from burrow_surprises where sent_at>=greatest(now()-interval '24 hours',(select activated_at from system_notification_policy where id))
  and expired_at is null and not exists(select 1 from system_notification_sources where kind='burrow_surprises' and system_notification_sources.id=burrow_surprises.id)
  order by sent_at limit 200 loop
   perform enqueue_surprise_push_v1(row.id);insert into system_notification_sources values('burrow_surprises',row.id) on conflict do nothing;
  end loop;
 for row in select p.id from profiles p where exists(select 1 from device_push_tokens t where t.user_id=p.id and t.enabled and t.notification_version>=2 and t.adventure_reminder_enabled)
  and adventure_reminder_eligible_v1(p.id,(now() at time zone notification_timezone_v1(p.id))::date)
  and not exists(select 1 from notification_outbox n where n.recipient_user_id=p.id and n.event_key='adventure-reminder:'||(now() at time zone notification_timezone_v1(p.id))::date)
  order by p.id limit 200 loop
   zone:=notification_timezone_v1(row.id);day:=(now() at time zone zone)::date;
   insert into notification_outbox(recipient_user_id,event_key,event_type,payload,expires_at)
   values(row.id,'adventure-reminder:'||day,'adventure_reminder',jsonb_build_object('localDate',day),(day+time '20:15') at time zone zone)
   on conflict(recipient_user_id,event_key) do nothing;scanned:=scanned+1;
 end loop;
 return jsonb_build_object('reminders',scanned);
end $$;

create function public.system_notification_context_v1(p_user uuid,p_type text,p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare partner uuid; session burrow_game_sessions%rowtype; allowed boolean:=false;
begin
 if p_type='adventure_reminder' then
  return jsonb_build_object('allowed',adventure_reminder_eligible_v1(p_user,(p_payload->>'localDate')::date));end if;
 select partner_user_id into partner from pairings where user_id=p_user;
 if partner is null or not exists(select 1 from pairings where user_id=partner and partner_user_id=p_user) then return jsonb_build_object('allowed',false);end if;
 if p_type in('game_invite','game_ready') then
  select * into session from burrow_game_sessions where id=(p_payload->>'sessionId')::uuid;
  allowed:=found and session.pair_low=least(p_user,partner) and session.pair_high=greatest(p_user,partner)
   and session.pair_version is not distinct from burrow_pair_version_v1(p_user,partner);
 elsif p_type='affection_received' then
  allowed:=p_payload->>'senderId'=partner::text and p_payload->>'pairVersion'=burrow_pair_version_v1(p_user,partner)
   and exists(select 1 from affection_events where id=(p_payload->>'eventId')::uuid and recipient_id=p_user and sender_id=partner and read_at is null);
 elsif p_type='surprise_received' then
  allowed:=p_payload->>'senderId'=partner::text and p_payload->>'pairVersion'=burrow_pair_version_v1(p_user,partner)
   and exists(select 1 from burrow_surprises where id=(p_payload->>'surpriseId')::uuid and recipient_id=p_user and sender_id=partner and sent_at is not null and expired_at is null and opened_at is null);
 end if;
 return jsonb_build_object('allowed',coalesce(allowed,false),'partnerName',(select display_name from profiles where id=partner));
end $$;

revoke all on function public.notification_timezone_v1(uuid),public.enqueue_affection_push_v1(uuid),public.enqueue_surprise_push_v1(uuid),
 public.capture_system_notification_v1(),public.adventure_reminder_eligible_v1(uuid,date,timestamptz),public.prepare_system_notifications_v1(),
 public.system_notification_context_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.notification_timezone_v1(uuid),public.enqueue_affection_push_v1(uuid),public.enqueue_surprise_push_v1(uuid),
 public.adventure_reminder_eligible_v1(uuid,date,timestamptz),public.prepare_system_notifications_v1(),public.system_notification_context_v1(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
