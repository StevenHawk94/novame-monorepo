-- One rolling 24-hour Custom Goal generation per user. The API stores the
-- generated candidates here so repeat taps/devices return the same result
-- without another AI call. A short `generating` row also acts as a lock.
create table if not exists public.quest_custom_generations (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  goal             text not null,
  tasks            jsonb,
  status           text not null default 'generating'
                   check (status in ('generating', 'ready', 'failed')),
  generation_token uuid not null,
  generated_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  constraint quest_custom_tasks_array check (
    tasks is null or jsonb_typeof(tasks) = 'array'
  )
);

create index if not exists idx_quest_custom_generations_expires
  on public.quest_custom_generations (expires_at);

alter table public.quest_custom_generations enable row level security;

-- No client policies: Custom Goal results are read/written only by the
-- authenticated API through its service-role client.
revoke all on table public.quest_custom_generations from anon;
revoke all on table public.quest_custom_generations from authenticated;
grant select, insert, update, delete on table public.quest_custom_generations to service_role;
