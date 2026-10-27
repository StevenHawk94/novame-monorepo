-- New finite dialogue/reward state is separate from legacy adventures.
create table public.adventure_dialogues_v2 (
  id text primary key, friend_id text not null references public.friend_definitions(stable_id),
  phase text not null check(phase in('Intro','Pool')), seq integer not null check(seq>0),
  weight numeric not null default 1 check(weight>0), content jsonb not null,
  status text not null default 'active' check(status in('active','retired'))
);
create index adventure_dialogues_friend on public.adventure_dialogues_v2(friend_id,phase,seq);
create table public.adventure_dialogue_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  dialogue_id text not null references public.adventure_dialogues_v2(id),
  adventure_id uuid not null references public.adventures(id), completed_at timestamptz not null default now(),
  primary key(user_id,dialogue_id), unique(adventure_id)
);
create table public.adventure_encounter_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id text references public.friend_definitions(stable_id),
  dialogue_id text references public.adventure_dialogues_v2(id),
  gift_id text references public.catalog_items(stable_id),
  adventure_id uuid unique references public.adventures(id) on delete cascade,
  status text not null default 'reserved' check(status in('reserved','bound','completed','cancelled')),
  snapshot jsonb not null, created_at timestamptz not null default now(),
  check((friend_id is null)=(dialogue_id is null))
);
create index adventure_plans_queue on public.adventure_encounter_plans(user_id,id) where status in('reserved','bound');
create unique index adventure_plan_unique_dialogue on public.adventure_encounter_plans(user_id,dialogue_id)
  where status<>'cancelled' and dialogue_id is not null;
create unique index adventure_plan_unique_gift on public.adventure_encounter_plans(user_id,gift_id)
  where status<>'cancelled' and gift_id is not null;
create table public.adventure_gift_display (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gift_id text not null references public.catalog_items(stable_id), updated_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['adventure_dialogues_v2','adventure_dialogue_completions','adventure_encounter_plans','adventure_gift_display'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence public.adventure_encounter_plans_id_seq to service_role;
notify pgrst,'reload schema';
