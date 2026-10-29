-- Explicitly approved 24FAGF <-> 88US9W, current relationship, 168 hours only.
-- Never rewrite economic domains, receipts, balances or own Store entitlements.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
create table public.burrow_temporary_test_pair(
 pair_low uuid primary key references public.profiles(id) on delete cascade,
 pair_high uuid not null references public.profiles(id) on delete cascade,
 pair_version text not null check(pair_version ~ '^[a-f0-9]{32}$'),
 enabled boolean not null default true,
 enabled_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default statement_timestamp()+interval '168 hours',
 check(pair_low='36b75655-a89b-45dd-b232-a35db4efe502'::uuid
   and pair_high='4d95e1b8-09e9-4904-aaaa-5e564dabb603'::uuid),
 check(isfinite(enabled_at) and isfinite(expires_at) and expires_at>enabled_at and expires_at<=enabled_at+interval '168 hours')
);
alter table public.burrow_temporary_test_pair enable row level security;
revoke all on public.burrow_temporary_test_pair from public,anon,authenticated,service_role;
grant select on public.burrow_temporary_test_pair to service_role;
insert into public.burrow_temporary_test_pair(pair_low,pair_high,pair_version)
select a.id,b.id,burrow_pair_version_v1(a.id,b.id)
from profiles a join profiles b on b.id='4d95e1b8-09e9-4904-aaaa-5e564dabb603'
join pairings pa on pa.user_id=a.id and pa.partner_user_id=b.id
join pairings pb on pb.user_id=b.id and pb.partner_user_id=a.id
where a.id='36b75655-a89b-45dd-b232-a35db4efe502'
 and a.invite_code='88US9W' and b.invite_code='24FAGF';
do $$begin
 if (select count(*) from burrow_temporary_test_pair)<>1 then raise exception 'Approved current test relationship changed';end if;
end $$;

create function public.burrow_test_pair_allowed_v1(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from burrow_temporary_test_pair t
  join pairings a on a.user_id=p_a and a.partner_user_id=p_b
  join pairings b on b.user_id=p_b and b.partner_user_id=p_a
  where p_a<>p_b and t.pair_low=least(p_a,p_b) and t.pair_high=greatest(p_a,p_b)
   and t.enabled and t.enabled_at<=statement_timestamp() and t.expires_at>statement_timestamp()
   and t.pair_version=burrow_pair_version_v1(p_a,p_b));
$$;
create function public.burrow_pair_economy_allowed_v1(p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select same_economic_domain_v1(p_a,p_b) or burrow_test_pair_allowed_v1(p_a,p_b);
$$;
revoke all on function public.burrow_test_pair_allowed_v1(uuid,uuid),public.burrow_pair_economy_allowed_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_test_pair_allowed_v1(uuid,uuid),public.burrow_pair_economy_allowed_v1(uuid,uuid) to service_role;

-- Exact, audited consumers only. Store admission/verification and the real
-- same_economic_domain_v1 are deliberately NOT patched.
do $patch$declare target regprocedure;expected int;original text;revised text;gate text;begin
 for target,expected in select * from (values
  ('public.burrow_has_plus_v1(uuid)'::regprocedure,1),
  ('public.sync_pair_plus_entitlements(uuid,uuid)'::regprocedure,1),
  ('public.join_current_partner_plus_v1(uuid,text)'::regprocedure,1),
  ('public.burrow_service_offer_v1(uuid,text,text)'::regprocedure,1),
  ('public.adventure_nudge_eligible_v1(uuid,uuid)'::regprocedure,1),
  ('public.adventure_team_snapshot_v1(uuid)'::regprocedure,1),
  ('public.start_adventure_v5(uuid,uuid,text,text,uuid,text)'::regprocedure,1),
  ('public.bind_unpaired_adventures_v1(uuid)'::regprocedure,1),
  ('public.prune_plushie_touch_v1(uuid)'::regprocedure,1),
  ('public.cleanup_plushie_touch_v1()'::regprocedure,1),
  ('public.send_plushie_touch_v1(uuid,uuid,text,date,uuid,text,uuid,jsonb)'::regprocedure,1),
  ('public.plushie_touch_state_v2(uuid,text)'::regprocedure,3)
 ) v loop
  original:=pg_get_functiondef(target);
  if (length(original)-length(replace(original,'same_economic_domain_v1(','')))/length('same_economic_domain_v1(')<>expected
   then raise exception 'Unreviewed pair permission consumer: %',target;end if;
  revised:=replace(original,'same_economic_domain_v1(','burrow_pair_economy_allowed_v1(');
  if target='public.plushie_touch_state_v2(uuid,text)'::regprocedure then
   -- This is a factual field, not permission; it must remain false cross-domain.
   if position('''sameDomain'',burrow_pair_economy_allowed_v1(p_user,partner)' in revised)=0
    then raise exception 'Unexpected true-domain payload';end if;
   revised:=replace(revised,'''sameDomain'',burrow_pair_economy_allowed_v1(p_user,partner)',
    '''sameDomain'',same_economic_domain_v1(p_user,partner)');
  end if;
  execute revised;
 end loop;
 -- Recover only never-bound pre-pair Solo trips for the approved test pair,
 -- under the original locks/cutoff. Existing trips/rewards are not rewritten
 -- at deployment; the normal snapshot/start transaction performs the binding.
 target:='public.adventure_team_snapshot_v1(uuid)'::regprocedure;
 original:=pg_get_functiondef(target);
 revised:=replace(original,'partner:=lock_burrow_pair(p_user);',
  'partner:=lock_burrow_pair(p_user); if burrow_test_pair_allowed_v1(p_user,partner) then perform bind_unpaired_adventures_v1(p_user);end if;');
 if revised=original then raise exception 'Unexpected snapshot pair lock';end if;execute revised;
 target:='public.start_adventure_v5(uuid,uuid,text,text,uuid,text)'::regprocedure;
 original:=pg_get_functiondef(target);
 revised:=replace(original,'receipt:=start_burrow_adventure_catalog_v1(',
  'if burrow_test_pair_allowed_v1(p_user_id,partner) then perform bind_unpaired_adventures_v1(p_user_id);end if; receipt:=start_burrow_adventure_catalog_v1(');
 if revised=original then raise exception 'Unexpected start reservation';end if;execute revised;
 -- Only this approved pair may look up an original committed Touch receipt
 -- after expiry. No missing receipt can pass the unchanged send gate.
 target:='public.send_plushie_touch_v1(uuid,uuid,text,date,uuid,text,uuid,jsonb)'::regprocedure;
 original:=pg_get_functiondef(target);
 gate:='if not burrow_pair_economy_allowed_v1(p_user,partner) and not plushie_touch_test_pair_allowed_v1(p_user,partner,p_pair) then return jsonb_build_object(''error'',''economic_domain_conflict'');end if;';
 revised:=replace(original,gate,
  'if not exists(select 1 from burrow_temporary_test_pair t where t.pair_low=least(p_user,partner) and t.pair_high=greatest(p_user,partner) and t.pair_version=p_pair) then '||gate||' end if;');
 if revised=original then raise exception 'Unexpected Touch receipt domain gate';end if;
 original:=revised;
 revised:=replace(original,'day:=(now() at time zone economic_timezone_v1(p_user))::date;',gate||' day:=(now() at time zone economic_timezone_v1(p_user))::date;');
 if revised=original then raise exception 'Unexpected Touch receipt boundary';end if;execute revised;
 -- Legacy upload-then-pay completes by updating sent_at (not paid_at), so its
 -- existing INSERT/paid_at transfer trigger alone cannot reject a new debit
 -- after expiry. Already-paid orders deliberately skip this offer branch.
 target:='public.complete_burrow_surprise_v1(uuid,uuid)'::regprocedure;
 original:=pg_get_functiondef(target);
 revised:=replace(original,'offer:=burrow_service_offer_v1(p_user,',
  'if exists(select 1 from burrow_temporary_test_pair t where t.pair_low=least(p_user,partner) and t.pair_high=greatest(p_user,partner)) and not burrow_pair_economy_allowed_v1(p_user,partner) then return jsonb_build_object(''error'',''economic_domain_mismatch'');end if; offer:=burrow_service_offer_v1(p_user,');
 if revised=original then raise exception 'Unexpected legacy Surprise payment boundary';end if;execute revised;
end $patch$;

-- Admission receipts let already committed gifts/paid Surprise orders finish
-- after expiry without authorizing a new transfer or a changed recipient.
create table public.burrow_test_transfer_admissions(
 relation_name text not null check(relation_name in('gifts','catalog_purchases','burrow_surprises')),
 row_id uuid not null,
 sender_id uuid not null references profiles(id) on delete cascade,
 recipient_id uuid not null references profiles(id) on delete cascade,
 pair_version text not null,
 admitted_at timestamptz not null default statement_timestamp(),
 primary key(relation_name,row_id),
 check(least(sender_id,recipient_id)='36b75655-a89b-45dd-b232-a35db4efe502'::uuid
  and greatest(sender_id,recipient_id)='4d95e1b8-09e9-4904-aaaa-5e564dabb603'::uuid)
);
alter table public.burrow_test_transfer_admissions enable row level security;
revoke all on public.burrow_test_transfer_admissions from public,anon,authenticated,service_role;
grant select on public.burrow_test_transfer_admissions to service_role;
create or replace function public.enforce_economic_transfer_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare sender uuid;previous jsonb;next_row jsonb:=to_jsonb(new);admitted boolean:=false;begin
 sender:=case when tg_table_name in('gifts','burrow_surprises') then (next_row->>'sender_id')::uuid else (next_row->>'buyer_id')::uuid end;
 if sender is not distinct from new.recipient_id or same_economic_domain_v1(sender,new.recipient_id) then return new;end if;
 if burrow_test_pair_allowed_v1(sender,new.recipient_id) then
  insert into burrow_test_transfer_admissions(relation_name,row_id,sender_id,recipient_id,pair_version)
   values(tg_table_name,(next_row->>'id')::uuid,sender,new.recipient_id,burrow_pair_version_v1(sender,new.recipient_id)) on conflict do nothing;
  return new;
 end if;
 if tg_op='UPDATE' then
  previous:=to_jsonb(old);
  select exists(select 1 from burrow_test_transfer_admissions r where r.relation_name=tg_table_name and r.row_id=(next_row->>'id')::uuid
   and r.sender_id=sender and r.recipient_id=new.recipient_id) into admitted;
  -- Preserve only immutable original transaction content and identity. The
  -- business claim/upload/refund RPC still performs its own current-pair checks.
  if admitted and next_row-array['status','claimed_at','read_at','seen_at','updated_at','sent_at','expired_at','refunded_at']
    =previous-array['status','claimed_at','read_at','seen_at','updated_at','sent_at','expired_at','refunded_at']
   and (tg_table_name<>'burrow_surprises' or previous->>'paid_at' is not null) then return new;end if;
 end if;
 raise exception 'economic_domain_mismatch' using errcode='23514';
end $$;
-- Existing trigger grants and all client permissions stay unchanged.
comment on table public.burrow_temporary_test_pair is
 'Approved 24FAGF/88US9W current relationship only. Automatic 168-hour expiry checked on every authorization. Set enabled=false to close early; never extend/re-enable without new approval.';
comment on table public.burrow_test_transfer_admissions is
 'Audit of transfers admitted under the temporary pair exception. Does not grant new transfers after expiry; retains original committed claim/upload/refund recovery.';
notify pgrst,'reload schema';
commit;
