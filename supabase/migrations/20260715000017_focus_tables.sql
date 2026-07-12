-- Focus sessions + per-scene progress (C10).
--
-- A Focus run plays one mindfulness track for a scene; completion is >= track
-- duration - 2s of accumulated playback (no seek bar, only pause/resume). The
-- scene's tracks cycle by next_index (work1, work2, ... wrap to 1). Free users
-- get 3 scenes, paid 8; the locked 5 are visible as a conversion point. Scene
-- permission is app-side (scenes are static config), so these tables only
-- record sessions and the play cursor.
create table if not exists public.focus_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles on delete cascade,
  scene_id    text not null,
  track_index smallint not null,
  completed   boolean not null default false,
  local_date  date not null,
  created_at  timestamptz default now()
);

create table if not exists public.user_focus_progress (
  user_id    uuid not null references public.profiles on delete cascade,
  scene_id   text not null,
  next_index smallint not null default 1,
  primary key (user_id, scene_id)
);

create index if not exists focus_by_user on public.focus_sessions (user_id, created_at desc);

alter table public.focus_sessions enable row level security;
alter table public.user_focus_progress enable row level security;

create policy focus_own on public.focus_sessions
  for select to authenticated using (auth.uid() = user_id);
create policy focus_service on public.focus_sessions
  for all to service_role using (true) with check (true);

create policy focus_prog_own on public.user_focus_progress
  for select to authenticated using (auth.uid() = user_id);
create policy focus_prog_service on public.user_focus_progress
  for all to service_role using (true) with check (true);
