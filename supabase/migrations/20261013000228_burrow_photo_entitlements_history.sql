-- Free: frame 1/day, each Doll 1/day. Shared Plus: frame 2/day,
-- each Doll 3/day. Frame history is hidden after 7 days for Free and
-- permanently retired after 30 days; Plus history has no expiry.
begin;
drop index if exists public.room_doll_actor_toy_day;
create index room_photo_daily_usage on public.room_photo_uploads(actor_id,kind,owner_id,toy_id,committed_date)
 where committed_at is not null;
create function public.burrow_photo_quota_v1(p_actor uuid,p_owner uuid,p_kind text,p_toy text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare paid boolean; today date; used integer; quota integer;
begin
 paid:=burrow_has_plus_v1(p_actor);
 select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into today from profiles where id=p_actor;
 quota:=case when p_kind='doll' then case when paid then 3 else 1 end else case when paid then 2 else 1 end end;
 select count(*) into used from room_photo_uploads where actor_id=p_actor and kind=p_kind
  and committed_date=today and committed_at is not null
  and (p_kind='frame' or (owner_id=p_owner and toy_id=coalesce(p_toy,'')));
 return jsonb_build_object('limit',quota,'used',used,'localDate',today,'remaining',greatest(0,quota-used));
end $$;
create function public.enforce_burrow_photo_quota_v1() returns trigger
language plpgsql security definer set search_path=public as $$
declare quota jsonb;
begin
 -- The commit trigger is the final authority for paired/solo/legacy clients.
 -- The same transaction rolls back the attachment if another device used the quota.
 if tg_op='INSERT' or (old.committed_at is null and new.committed_at is not null) then
  perform pg_advisory_xact_lock(hashtextextended('photo-quota:'||new.actor_id::text,0));
  quota:=burrow_photo_quota_v1(new.actor_id,new.owner_id,new.kind,new.toy_id);
  if (quota->>'remaining')::integer<=0 then raise exception 'daily_limit_reached' using errcode='P0001'; end if;
 end if;
 return new;
end $$;
create trigger room_photo_quota before insert or update of committed_at on public.room_photo_uploads
 for each row execute function public.enforce_burrow_photo_quota_v1();
-- Remove the old one-per-day check without changing ownership/pair guards.
do $$ declare signature text; original text; revised text; begin
 foreach signature in array array['public.prepare_toy_photo_v1(uuid,uuid,text,uuid,uuid,text)','public.complete_toy_photo_v1(uuid,uuid)'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  revised:=regexp_replace(original,
    'if exists\(select 1 from room_photo_uploads where actor_id=p_user_id and owner_id=(p_owner_id|ticket.owner_id)[[:space:]]+and kind=''doll''[[:space:]]+and toy_id=(item|ticket.toy_id) and committed_date=today and committed_at is not null\)',
    'if (burrow_photo_quota_v1(p_user_id,\1,''doll'',\2)->>''remaining'')::integer<=0');
  -- Latest complete function places "and kind" on the preceding line.
  if revised=original then
   revised:=regexp_replace(original,
    'if exists\(select 1 from room_photo_uploads where actor_id=p_user_id and owner_id=ticket.owner_id and kind=''doll''[[:space:]]+and toy_id=ticket.toy_id and committed_date=today and committed_at is not null\)',
    'if (burrow_photo_quota_v1(p_user_id,ticket.owner_id,''doll'',ticket.toy_id)->>''remaining'')::integer<=0');
  end if;
  if revised=original then raise exception 'Unexpected toy photo quota definition: %',signature; end if;
  execute revised;
 end loop;
end $$;
create table public.burrow_frame_photo_history(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references profiles(id) on delete cascade,
 private_path text not null unique,created_at timestamptz not null default now(),retired_at timestamptz);
create index burrow_frame_history_owner on public.burrow_frame_photo_history(owner_id,created_at desc,id desc) where retired_at is null;
alter table public.burrow_frame_photo_history enable row level security;
revoke all on public.burrow_frame_photo_history from public,anon,authenticated;
grant all on public.burrow_frame_photo_history to service_role;
-- Only backfill currently attached bytes. Older replaced files may already be gone.
insert into burrow_frame_photo_history(owner_id,private_path,created_at)
 select owner_id,private_path,updated_at from room_photos where kind='frame' on conflict(private_path) do nothing;
create function public.archive_burrow_frame_photo_v1() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.kind='frame' and old.committed_at is null and new.committed_at is not null then
  insert into burrow_frame_photo_history(owner_id,private_path,created_at) values(new.owner_id,new.private_path,new.committed_at)
   on conflict(private_path) do nothing;
 end if;
 return new;
end $$;
create trigger room_frame_archive after update of committed_at on public.room_photo_uploads
 for each row execute function public.archive_burrow_frame_photo_v1();
create function public.retire_burrow_frame_history_path_v1() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into room_photo_garbage(private_path) values(old.private_path) on conflict do nothing;
 return old;
end $$;
create trigger frame_history_delete after delete on public.burrow_frame_photo_history
 for each row execute function public.retire_burrow_frame_history_path_v1();
create function public.read_burrow_frame_history_v1(p_user uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare paid boolean; items jsonb; more boolean; last_item jsonb;
begin
 if (p_before is null)<>(p_before_id is null) then return jsonb_build_object('error','invalid_request'); end if;
 paid:=burrow_has_plus_v1(p_user);
 select coalesce(jsonb_agg(to_jsonb(h) order by created_at desc,id desc),'[]'::jsonb) into items from(
  select id,created_at,private_path from burrow_frame_photo_history where owner_id=p_user and retired_at is null
   and (paid or created_at>=now()-interval '7 days')
   and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 31
 ) h;
 more:=jsonb_array_length(items)>30;
 if more then items:=items-30; end if;
 last_item:=items->29;
 return jsonb_build_object('items',items,'hasPlus',paid,'nextCursor',case when more
  then jsonb_build_object('createdAt',last_item->>'created_at','id',last_item->>'id') else null end);
end $$;
create function public.burrow_photo_usage_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare today date; paid boolean; targets jsonb;
begin
 paid:=burrow_has_plus_v1(p_user);
 select (now() at time zone coalesce(nullif(timezone_name,''),'UTC'))::date into today from profiles where id=p_user;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into targets from(
  select owner_id as "ownerId",toy_id as "toyId",count(*) as used from room_photo_uploads
   where actor_id=p_user and kind='doll' and committed_date=today and committed_at is not null group by owner_id,toy_id
 ) t;
 return jsonb_build_object('localDate',today,'frame',burrow_photo_quota_v1(p_user,p_user,'frame'),
  'doll',jsonb_build_object('limit',case when paid then 3 else 1 end,'targets',targets));
end $$;
alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_before_photo_history_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; usage jsonb; exhausted jsonb;
begin
 result:=burrow_bootstrap_before_photo_history_v1(p_user_id);
 if result->>'error' is not null then return result; end if;
 usage:=burrow_photo_usage_v1(p_user_id);
 select coalesce(jsonb_agg(t),'[]'::jsonb) into exhausted from jsonb_array_elements(usage->'doll'->'targets') t
  where (t->>'used')::integer>=(usage->'doll'->>'limit')::integer;
 return result||jsonb_build_object('photoUsage',usage,'dollPhotoChangeTargetsUsed',exhausted,
  'dollPhotoChangesUsed',coalesce((select jsonb_agg(t->>'toyId') from jsonb_array_elements(exhausted) t where t->>'ownerId'=p_user_id::text),'[]'::jsonb));
end $$;
-- Preserve every unexpired history path, even when the current frame changes.
-- Retirement is a durable tombstone. A subsequent upgrade cannot resurrect a
-- path already selected for deletion; a failed Storage deletion remains queued.
create or replace function public.collect_room_photo_garbage_v1() returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 with expired as(
  select id from burrow_frame_photo_history where retired_at is null and created_at<now()-interval '30 days'
   and not burrow_has_plus_v1(owner_id) order by created_at for update skip locked limit 100
 ), retired as(
  update burrow_frame_photo_history set retired_at=now() where id in(select id from expired) returning private_path
 ) insert into room_photo_garbage(private_path,not_before) select private_path,now() from retired
  on conflict(private_path) do update set not_before=least(room_photo_garbage.not_before,excluded.not_before);
 delete from room_photos p using burrow_frame_photo_history h where p.kind='frame' and p.private_path=h.private_path and h.retired_at is not null;
 with retired as(
  update room_photo_uploads set expired_at=now() where id in(
   select id from room_photo_uploads where committed_at is null and expired_at is null
    and created_at<now()-interval '24 hours' order by created_at limit 100 for update skip locked
  ) returning private_path
 ) insert into room_photo_garbage(private_path) select private_path from retired on conflict do nothing;
 return coalesce((select jsonb_agg(private_path) from(
  select g.private_path from room_photo_garbage g where not_before<=now()
   and not exists(select 1 from room_photos p where p.private_path=g.private_path)
   and not exists(select 1 from burrow_frame_photo_history h where h.private_path=g.private_path and h.retired_at is null)
   and not exists(select 1 from room_photo_uploads u where u.private_path=g.private_path and u.committed_at is null and u.expired_at is null)
   order by not_before,private_path limit 100
 ) due),'[]'::jsonb);
end $$;
revoke all on function public.burrow_photo_quota_v1(uuid,uuid,text,text),public.enforce_burrow_photo_quota_v1(),
 public.archive_burrow_frame_photo_v1(),public.retire_burrow_frame_history_path_v1(),public.read_burrow_frame_history_v1(uuid,timestamptz,uuid),
 public.burrow_photo_usage_v1(uuid),public.burrow_bootstrap_before_photo_history_v1(uuid),public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
revoke all on function public.burrow_bootstrap_before_photo_history_v1(uuid) from service_role;
grant execute on function public.read_burrow_frame_history_v1(uuid,timestamptz,uuid),public.burrow_photo_usage_v1(uuid),public.burrow_bootstrap_v1(uuid) to service_role;
notify pgrst,'reload schema';
commit;
