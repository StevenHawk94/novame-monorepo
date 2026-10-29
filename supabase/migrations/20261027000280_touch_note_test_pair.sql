-- Approved YRZQDM <-> HA54J3 Touch Note-only transport exception.
-- Never change same_economic_domain_v1, entitlements, wallets or other features.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
create table public.plushie_touch_test_pair(
 pair_low uuid primary key references public.profiles(id) on delete cascade,
 pair_high uuid not null references public.profiles(id) on delete cascade,
 pair_version text not null check(pair_version ~ '^[a-f0-9]{32}$'),
 enabled boolean not null default true,
 check(pair_low='b8ebeeb8-4353-4baa-a75e-ace1ab4a0af1'::uuid
   and pair_high='d896d176-96f7-4f7f-af15-42284f251251'::uuid)
);
alter table public.plushie_touch_test_pair enable row level security;
revoke all on public.plushie_touch_test_pair from public,anon,authenticated,service_role;
grant select on public.plushie_touch_test_pair to service_role;
-- Freeze this relationship, not a reusable invite code or client development flag.
insert into public.plushie_touch_test_pair(pair_low,pair_high,pair_version)
select a.id,b.id,public.burrow_pair_version_v1(a.id,b.id)
from public.profiles a join public.profiles b on b.id='d896d176-96f7-4f7f-af15-42284f251251'
join public.pairings pa on pa.user_id=a.id and pa.partner_user_id=b.id
join public.pairings pb on pb.user_id=b.id and pb.partner_user_id=a.id
where a.id='b8ebeeb8-4353-4baa-a75e-ace1ab4a0af1';
do $$begin
 if (select count(*) from public.plushie_touch_test_pair)<>1 then raise exception 'Approved Touch Note pair is not mutually paired';end if;
end $$;

create function public.plushie_touch_test_pair_allowed_v1(p_a uuid,p_b uuid,p_pair text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select p_a is not null and p_b is not null and p_a<>p_b and p_pair is not null
 and exists(select 1 from plushie_touch_test_pair t
  join pairings a on a.user_id=p_a and a.partner_user_id=p_b
  join pairings b on b.user_id=p_b and b.partner_user_id=p_a
  where t.enabled and t.pair_low=least(p_a,p_b) and t.pair_high=greatest(p_a,p_b)
   and t.pair_version=p_pair and t.pair_version=burrow_pair_version_v1(p_a,p_b));
$$;
revoke all on function public.plushie_touch_test_pair_allowed_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.plushie_touch_test_pair_allowed_v1(uuid,uuid,text) to service_role;

-- Patch only the domain rejection in the existing atomic send. All original
-- quota/receipt/photo/ownership/notification validation remains in that body.
do $patch$declare old text;revised text;needle text;begin
 old:=pg_get_functiondef('public.send_plushie_touch_v1(uuid,uuid,text,date,uuid,text,uuid,jsonb)'::regprocedure);
 needle:='if not same_economic_domain_v1(p_user,partner) then return jsonb_build_object(''error'',''economic_domain_conflict'');end if;';
 revised:=replace(old,needle,'if not same_economic_domain_v1(p_user,partner) and not plushie_touch_test_pair_allowed_v1(p_user,partner,p_pair) then return jsonb_build_object(''error'',''economic_domain_conflict'');end if;');
 if revised=old then raise exception 'Unexpected Touch Note send definition';end if;execute revised;

 old:=pg_get_functiondef('public.plushie_touch_state_v2(uuid,text)'::regprocedure);
 revised:=replace(old,'declare partner uuid;plus boolean;day date;used int;','declare partner uuid;plus boolean;day date;used int;send_plus boolean;send_allowed boolean;');
 if revised=old then raise exception 'Unexpected Touch Note state declaration';end if;old:=revised;
 needle:='plus:=burrow_has_plus_v1(p_user) and same_economic_domain_v1(p_user,partner);';
 revised:=replace(old,needle,needle||chr(10)||
 ' send_allowed:=same_economic_domain_v1(p_user,partner) or plushie_touch_test_pair_allowed_v1(p_user,partner,p_pair);'||chr(10)||
 ' send_plus:=plus or (plushie_touch_test_pair_allowed_v1(p_user,partner,p_pair) and burrow_has_plus_v1(p_user));');
 if revised=old then raise exception 'Unexpected Touch Note state entitlement';end if;old:=revised;
 revised:=replace(old,'case when plus then local_date=day','case when send_plus then local_date=day');
 if revised=old then raise exception 'Unexpected Touch Note state quota';end if;old:=revised;
 revised:=replace(old,'''hasPlus'',plus,','''hasPlus'',plus,''sendAllowed'',send_allowed,''sendHasPlus'',send_plus,');
 if revised=old then raise exception 'Unexpected Touch Note state payload';end if;execute revised;
end $patch$;
comment on table public.plushie_touch_test_pair is
 'User-approved Touch Note-only pair exception, current relationship only. Set enabled=false to close. No Plus sharing or economic domain mutation; not Metro-only.';
notify pgrst,'reload schema';
commit;
