-- Approved: no daily Plushie quota; one current face per owner/toy. Free
-- frame history expires after 30 days except the currently displayed frame.
-- Does not publish a catalog, change payments, or delete Storage inside SQL.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
lock table public.room_photos in share row exclusive mode;

-- Retain the same latest-photo ordering used by the client. DELETE triggers
-- queue superseded private bytes; immutable upload/accounting receipts stay.
with ranked as (
 select id,row_number() over(partition by owner_id,toy_id order by updated_at desc,id desc) n
 from public.room_photos where kind='doll'
)
delete from public.room_photos p using ranked r where p.id=r.id and r.n>1;
create unique index if not exists room_photo_one_face_per_toy
 on public.room_photos(owner_id,toy_id) where kind='doll';

-- Across solo/pair/re-pair writes the existing row ID is retained and only
-- that toy's face/path is replaced. Database uniqueness protects concurrent
-- writers; all original target/partner/digest/expiry/receipt checks remain.
do $$ declare signature text; original text; revised text;
 old_clause text:='on conflict(pair_low,pair_high,owner_id,kind,toy_id) do update set private_path=excluded.private_path,';
 new_clause text:='on conflict(owner_id,toy_id) where kind=''doll'' do update set pair_low=excluded.pair_low,pair_high=excluded.pair_high,private_path=excluded.private_path,';
begin
 foreach signature in array array['public.complete_toy_photo_v1(uuid,uuid)','public.complete_personal_toy_photo_v1(uuid,uuid)'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  if position(new_clause in original)>0 then continue; end if;
  if position(old_clause in original)=0 then raise exception 'Photo completion definition changed: %',signature; end if;
  revised:=replace(original,old_clause,new_clause);
  execute revised;
 end loop;
end $$;

create or replace function public.burrow_photo_quota_v1(p_actor uuid,p_owner uuid,p_kind text,p_toy text default '') returns jsonb
language plpgsql security definer set search_path=public as $$
declare paid boolean; today date; used integer; quota integer;
begin
 today:=(now() at time zone public.economic_timezone_v1(p_actor))::date;
 select count(*) into used from room_photo_uploads where actor_id=p_actor and kind=p_kind
  and committed_date=today and committed_at is not null
  and (p_kind='frame' or (owner_id=p_owner and toy_id=coalesce(p_toy,'')));
 if p_kind='doll' then
  return jsonb_build_object('limit',null,'used',used,'localDate',today,'remaining',null,'unlimited',true);
 end if;
 paid:=burrow_has_plus_v1(p_actor);quota:=case when paid then 2 else 1 end;
 return jsonb_build_object('limit',quota,'used',used,'localDate',today,'remaining',greatest(0,quota-used));
end $$;
create or replace function public.burrow_photo_usage_v1(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare today date; targets jsonb;
begin
 today:=(now() at time zone public.economic_timezone_v1(p_user))::date;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into targets from(
  select owner_id as "ownerId",toy_id as "toyId",count(*) as used from room_photo_uploads
   where actor_id=p_user and kind='doll' and committed_date=today and committed_at is not null group by owner_id,toy_id
 ) t;
 return jsonb_build_object('localDate',today,'frame',burrow_photo_quota_v1(p_user,p_user,'frame'),
  -- Old clients compare used >= limit and cannot interpret JSON null. This
  -- unreachable display ceiling is compatibility only; the quota RPC above
  -- has no daily limit. The authenticated API's 10/hour guard remains real.
  'doll',jsonb_build_object('limit',2147483647,'unlimited',true,'targets',targets));
end $$;

-- One queue deadline for an obsolete face; the worker runs every 5 minutes.
-- Never shorten an existing earlier deadline on an idempotent enqueue/retry.
insert into public.room_photo_garbage(private_path,not_before)
 select u.private_path,now()+interval '1 hour' from public.room_photo_uploads u
 where u.kind='doll' and u.committed_at is not null
 and not exists(select 1 from public.room_photos p where p.private_path=u.private_path)
 on conflict(private_path) do update set not_before=least(room_photo_garbage.not_before,excluded.not_before);

-- Select just one displayable current frame per owner. Preserve existing
-- solo/current-mutual-pair visibility, not old relationship access rights.
create or replace function public.collect_room_photo_garbage_v1() returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 with current_frames as (
  select distinct on(p.owner_id) p.owner_id,p.private_path
  from room_photos p where p.kind='frame' and (
   p.pair_low=p.owner_id and p.pair_high=p.owner_id or exists(
    select 1 from pairings a join pairings b on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id
    where a.user_id=p.owner_id and p.pair_low=least(a.user_id,a.partner_user_id)
     and p.pair_high=greatest(a.user_id,a.partner_user_id)))
  order by p.owner_id,p.updated_at desc,p.id desc
 ), expired as (
  select h.id from burrow_frame_photo_history h where h.retired_at is null
   and h.created_at<now()-interval '30 days' and not burrow_has_plus_v1(h.owner_id)
   and not exists(select 1 from current_frames c where c.owner_id=h.owner_id and c.private_path=h.private_path)
   order by h.created_at for update of h skip locked limit 100
 ), retired as (
  update burrow_frame_photo_history set retired_at=now() where id in(select id from expired) returning private_path
 ) insert into room_photo_garbage(private_path,not_before) select private_path,now() from retired
  on conflict(private_path) do update set not_before=least(room_photo_garbage.not_before,excluded.not_before);
 delete from room_photos p using burrow_frame_photo_history h
  where p.kind='frame' and p.private_path=h.private_path and h.retired_at is not null;
 with retired as (
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
revoke all on function public.burrow_photo_quota_v1(uuid,uuid,text,text),public.burrow_photo_usage_v1(uuid),
 public.collect_room_photo_garbage_v1() from public,anon,authenticated;
grant execute on function public.burrow_photo_usage_v1(uuid),public.collect_room_photo_garbage_v1() to service_role;
notify pgrst,'reload schema';
commit;
