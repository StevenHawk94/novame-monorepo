-- Connection Dashboard (2026-07-24 需求): the pairing carries a RELATIONSHIP
-- (Lover / Best Friend / Mom and Daughter / Siblings / Someone Special /
-- Others) and its start date; invitations propose them, accept copies them
-- onto the pairing. Plus AI insights are cached per pair per day.

-- 1. relationship rides on the invitation (friendships) ----------------------
alter table public.friendships
  add column if not exists relationship text,
  add column if not exists relationship_since date;

-- 2. and lives on the pairing ------------------------------------------------
alter table public.pairings
  add column if not exists relationship text,
  add column if not exists relationship_since date;

-- 3. set_pairing v2: accepts the relationship (both mirrored rows get it) ----
drop function if exists public.set_pairing(uuid, uuid);

create or replace function public.set_pairing(
  p_user_id      uuid,
  p_partner_id   uuid,
  p_relationship text default null,
  p_since        date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid; v_b uuid;
begin
  if p_user_id = p_partner_id then
    return jsonb_build_object('error', 'cannot_pair_self');
  end if;
  v_a := least(p_user_id, p_partner_id);
  v_b := greatest(p_user_id, p_partner_id);
  perform pg_advisory_xact_lock(hashtextextended(v_a::text || v_b::text, 0));

  perform 1 from public.friendships
   where user_a = v_a and user_b = v_b and status = 'accepted';
  if not found then
    return jsonb_build_object('error', 'not_friends');
  end if;

  if exists (select 1 from public.pairings where user_id = p_user_id) then
    return jsonb_build_object('error', 'already_paired');
  end if;
  if exists (select 1 from public.pairings where user_id = p_partner_id) then
    return jsonb_build_object('error', 'partner_already_paired');
  end if;

  insert into public.pairings (user_id, partner_user_id, relationship, relationship_since) values
    (p_user_id, p_partner_id, p_relationship, p_since),
    (p_partner_id, p_user_id, p_relationship, p_since);
  return jsonb_build_object('error', null, 'paired_with', p_partner_id);
end;
$$;

revoke all on function public.set_pairing(uuid, uuid, text, date) from public;
revoke all on function public.set_pairing(uuid, uuid, text, date) from anon;
revoke all on function public.set_pairing(uuid, uuid, text, date) from authenticated;
grant execute on function public.set_pairing(uuid, uuid, text, date) to service_role;

-- 4. Plus insights cache (one AI run per pair per day) -----------------------
create table if not exists public.connection_insights (
  user_a     uuid not null references public.profiles on delete cascade,
  user_b     uuid not null references public.profiles on delete cascade,
  for_date   date not null,
  -- Which member this payload is FOR (insights read the *partner's* input,
  -- so each member gets their own payload).
  for_user   uuid not null references public.profiles on delete cascade,
  payload    jsonb not null,
  created_at timestamptz default now(),
  primary key (user_a, user_b, for_date, for_user),
  check (user_a < user_b)
);
alter table public.connection_insights enable row level security;
create policy connection_insights_own on public.connection_insights
  for select to authenticated using (auth.uid() = for_user);
create policy connection_insights_service on public.connection_insights
  for all to service_role using (true) with check (true);
