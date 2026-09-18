create table if not exists public.marketing_paywall_variants (
  id uuid primary key default gen_random_uuid(),
  campaign text not null,
  variant_key text not null,
  headline text not null,
  subheadline text not null,
  cta_heading text not null,
  benefits jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  weight integer not null default 100 check (weight between 0 and 10000),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign, variant_key)
);

create table if not exists public.marketing_paywall_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  variant_id uuid not null references public.marketing_paywall_variants(id) on delete restrict,
  campaign text not null,
  trigger_key text not null,
  event_type text not null check (event_type in ('impression', 'click')),
  created_at timestamptz not null default now(),
  unique (user_id, campaign, trigger_key, event_type)
);

create index if not exists marketing_paywall_events_variant_type_idx
  on public.marketing_paywall_events(variant_id, event_type, created_at desc);

create table if not exists public.marketing_paywall_triggers (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign text not null,
  trigger_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, campaign, trigger_key)
);

create index if not exists marketing_paywall_triggers_pending_idx
  on public.marketing_paywall_triggers(user_id, campaign, created_at desc);

alter table public.marketing_paywall_variants enable row level security;
alter table public.marketing_paywall_events enable row level security;
alter table public.marketing_paywall_triggers enable row level security;
revoke all on public.marketing_paywall_variants, public.marketing_paywall_events, public.marketing_paywall_triggers from anon, authenticated;
grant all on public.marketing_paywall_variants, public.marketing_paywall_events, public.marketing_paywall_triggers to service_role;

insert into public.marketing_paywall_variants
  (campaign, variant_key, headline, subheadline, cta_heading, benefits, weight, sort_order)
values
  ('partner_reflect', 'A', 'Your partner just reflected on their day.', 'Behind it, there might be a moment they needed you to notice.', 'Go Plus for Real-Time Insight',
   '["The moments that could bring you closer don''t just slip by","Know when to reach out, and when to give space","Understand whether they need comfort, encouragement, or someone to listen","Never miss the moments when they need you most"]'::jsonb, 100, 1),
  ('partner_reflect', 'B', 'A window just opened.', 'Right now, there''s a small chance to understand them a little better than yesterday.', 'Go Plus for Real-Time Insight',
   '["Catch the moments worth showing up for","Know when to reach out, and when to give space","Sense what they need — comfort, encouragement, or just an ear","Make today the day you got a little closer"]'::jsonb, 100, 2),
  ('partner_reflect', 'C', 'Curious what today was really like for them?', 'Plus gives you a gentle read on what''s underneath.', 'Go Plus for Real-Time Insight',
   '["A better sense of how their day actually went","Know when to check in, and when to hold back","Understand what kind of support fits the moment","Always have a good read on how to show up"]'::jsonb, 100, 3),
  ('partner_reflect', 'D', '“Fine” doesn''t always mean fine.', 'Real-Time Insight helps you know which one it was.', 'Go Plus for Real-Time Insight',
   '["Spot the moments behind “I''m okay”","Know when to reach out, and when to give space","Sense whether they need comfort, encouragement, or space","Never miss the moments when they need you most"]'::jsonb, 100, 4),
  ('partner_reflect', 'E', 'What did today actually look like for them?', 'Reflect just captured it — Plus helps you understand it.', 'Go Plus for Real-Time Insight',
   '["Turn their day from a headline into something you actually understand","Know when to reach out, and when to give space","Sense what kind of support fits the moment","Catch the moments that bring you closer"]'::jsonb, 100, 5)
on conflict (campaign, variant_key) do update set
  headline = excluded.headline,
  subheadline = excluded.subheadline,
  cta_heading = excluded.cta_heading,
  benefits = excluded.benefits,
  weight = excluded.weight,
  sort_order = excluded.sort_order,
  is_archived = false,
  updated_at = now();

drop function if exists public.broadcast_reflect_feed_change(uuid);

create function public.broadcast_reflect_feed_change(
  p_user_id uuid,
  p_reflect_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid;
begin
  select partner_user_id into v_partner from public.pairings where user_id = p_user_id;
  if v_partner is null then return; end if;
  perform realtime.send(
    jsonb_build_object('author_user_id', p_user_id, 'reflect_id', p_reflect_id),
    'reflect_feed_changed',
    'pairing:' || v_partner::text,
    true
  );
end;
$$;

revoke all on function public.broadcast_reflect_feed_change(uuid, uuid) from public, anon, authenticated;
grant execute on function public.broadcast_reflect_feed_change(uuid, uuid) to service_role;
