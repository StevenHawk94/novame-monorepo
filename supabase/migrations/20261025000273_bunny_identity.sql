-- Approved 2026-10-25: visual identity only; no inventory/room/economy writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.bunny_identities (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 variant text not null check(variant in('biscuit','pinky')),
 finalized boolean not null default false,
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now()
);
alter table public.bunny_identities enable row level security;
revoke all on public.bunny_identities from public,anon,authenticated;
grant select on public.bunny_identities to service_role;

create function public.bunny_identity_signal_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
  perform realtime.send('{}'::jsonb,'bunny_changed','burrow:'||new.user_id::text,true);
 end if;
 return new;
exception when others then return new; -- authenticated bootstrap recovers missed signals
end $$;
create trigger bunny_identity_signal after insert or update on public.bunny_identities
 for each row execute function public.bunny_identity_signal_v1();

-- Caller holds the pairing/identity locks. Finalized identities NEVER change,
-- including same-colour accounts pairing again after an earlier relationship.
create function public.assign_pair_bunnies_v1(p_actor uuid,p_partner uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare a bunny_identities%rowtype; b bunny_identities%rowtype; chosen text;
begin
 if p_actor=p_partner or not exists(select 1 from pairings x join pairings y
  on y.user_id=x.partner_user_id and y.partner_user_id=x.user_id
  where x.user_id=p_actor and x.partner_user_id=p_partner) then raise exception 'pair_changed'; end if;
 perform pg_advisory_xact_lock(hashtextextended('bunny:'||least(p_actor,p_partner)::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bunny:'||greatest(p_actor,p_partner)::text,0));
 select * into a from bunny_identities where user_id=p_actor;
 select * into b from bunny_identities where user_id=p_partner;
 if coalesce(a.finalized,false) and coalesce(b.finalized,false) then return; end if;
 chosen:=coalesce(a.variant,'biscuit');
 if coalesce(b.finalized,false) and not coalesce(a.finalized,false) then
  chosen:=case b.variant when 'biscuit' then 'pinky' else 'biscuit' end;
 end if;
 insert into bunny_identities(user_id,variant,finalized) values(p_actor,chosen,true)
 on conflict(user_id) do update set variant=excluded.variant,finalized=true,
  revision=bunny_identities.revision+1,updated_at=now() where not bunny_identities.finalized;
 insert into bunny_identities(user_id,variant,finalized)
 values(p_partner,case chosen when 'biscuit' then 'pinky' else 'biscuit' end,true)
 on conflict(user_id) do update set
  variant=case when bunny_identities.variant<>chosen then bunny_identities.variant else excluded.variant end,
  finalized=true,revision=bunny_identities.revision+1,updated_at=now() where not bunny_identities.finalized;
end $$;

-- Approved legacy exception: recorded historical relationship initiator gets
-- Biscuit. Pre-code pairings cannot prove who entered a code; never claim they
-- can. Future code pairing below uses the actual authenticated code enterer.
do $$declare r record;begin
 for r in select f.requested_by actor,case when f.requested_by=x.user_id then x.partner_user_id else x.user_id end partner
 from pairings x join pairings y on y.user_id=x.partner_user_id and y.partner_user_id=x.user_id
 join friendships f on f.user_a=least(x.user_id,x.partner_user_id) and f.user_b=greatest(x.user_id,x.partner_user_id)
 where x.user_id<x.partner_user_id and f.status='accepted' and f.requested_by in(x.user_id,x.partner_user_id)
 loop perform assign_pair_bunnies_v1(r.actor,r.partner);end loop;
end $$;

alter function public.pair_immediately(uuid,uuid,text,date) rename to pair_immediately_before_bunny_v1;
create function public.pair_immediately(p_user_id uuid,p_partner_id uuid,p_relationship text default 'Partner',p_since date default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt jsonb;begin
 receipt:=pair_immediately_before_bunny_v1(p_user_id,p_partner_id,p_relationship,p_since);
 if receipt->>'error' is null then perform assign_pair_bunnies_v1(p_user_id,p_partner_id);end if;
 return receipt;
end $$;
alter function public.set_pairing(uuid,uuid,text,date) rename to set_pairing_before_bunny_v1;
create function public.set_pairing(p_user_id uuid,p_partner_id uuid,p_relationship text default null,p_since date default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt jsonb;begin
 receipt:=set_pairing_before_bunny_v1(p_user_id,p_partner_id,p_relationship,p_since);
 if receipt->>'error' is null then perform assign_pair_bunnies_v1(p_user_id,p_partner_id);end if;
 return receipt;
end $$;

create function public.bunny_identity_v1(p_user uuid,p_finalize boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid; mine bunny_identities%rowtype; theirs bunny_identities%rowtype;
begin
 partner:=lock_burrow_pair(p_user);
 if not exists(select 1 from profiles where id=p_user) then return jsonb_build_object('error','profile_not_found');end if;
 -- Before initial selection, reads must not allocate a default that prevents
 -- onboarding choosing Pinky. Home explicitly finalizes a saved solo choice.
 perform pg_advisory_xact_lock(hashtextextended('bunny:'||least(p_user,coalesce(partner,p_user))::text,0));
 if partner is not null then perform pg_advisory_xact_lock(hashtextextended('bunny:'||greatest(p_user,partner)::text,0));end if;
 if p_finalize then
  insert into bunny_identities(user_id,variant,finalized) values(p_user,'biscuit',true)
  on conflict(user_id) do update set finalized=true,revision=bunny_identities.revision+1,updated_at=now()
   where not bunny_identities.finalized;
 end if;
 select * into mine from bunny_identities where user_id=p_user;
 if partner is not null then select * into theirs from bunny_identities where user_id=partner;end if;
 return jsonb_build_object('userId',p_user,'variant',mine.variant,'finalized',coalesce(mine.finalized,false),
  'revision',coalesce(mine.revision,0),'partnerId',partner,'partnerVariant',theirs.variant,
  'pairVersion',case when partner is not null then burrow_pair_version_v1(p_user,partner) end);
end $$;

create function public.select_bunny_v1(p_user uuid,p_variant text,p_key uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare partner uuid; old burrow_command_receipts%rowtype; mine bunny_identities%rowtype; result jsonb;
 intent jsonb:=jsonb_build_object('action','select_bunny','variant',p_variant);
begin
 if p_key is null or p_variant not in('biscuit','pinky') or p_variant is null then return jsonb_build_object('error','invalid_request');end if;
 partner:=lock_burrow_pair(p_user);
 perform pg_advisory_xact_lock(hashtextextended('bunny:'||least(p_user,coalesce(partner,p_user))::text,0));
 if partner is not null then perform pg_advisory_xact_lock(hashtextextended('bunny:'||greatest(p_user,partner)::text,0));end if;
 select * into old from burrow_command_receipts where actor_id=p_user and command_key='bunny:'||p_key;
 if found then
  if old.request<>intent then return jsonb_build_object('error','idempotency_conflict');end if;
  return old.response;
 end if;
 select * into mine from bunny_identities where user_id=p_user;
 if mine.finalized and mine.variant<>p_variant then return jsonb_build_object('error','bunny_finalized');end if;
 insert into bunny_identities(user_id,variant) values(p_user,p_variant)
 on conflict(user_id) do update set variant=excluded.variant,revision=bunny_identities.revision+1,updated_at=now()
  where not bunny_identities.finalized and bunny_identities.variant<>excluded.variant;
 if partner is not null then perform assign_pair_bunnies_v1(p_user,partner);end if;
 result:=bunny_identity_v1(p_user,false);
 insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user,'bunny:'||p_key,intent,result);
 return result;
end $$;

revoke all on function public.bunny_identity_signal_v1(),public.assign_pair_bunnies_v1(uuid,uuid),
 public.pair_immediately_before_bunny_v1(uuid,uuid,text,date),public.pair_immediately(uuid,uuid,text,date),
 public.set_pairing_before_bunny_v1(uuid,uuid,text,date),public.set_pairing(uuid,uuid,text,date),
 public.bunny_identity_v1(uuid,boolean),public.select_bunny_v1(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.pair_immediately(uuid,uuid,text,date),public.set_pairing(uuid,uuid,text,date),
 public.bunny_identity_v1(uuid,boolean),public.select_bunny_v1(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
