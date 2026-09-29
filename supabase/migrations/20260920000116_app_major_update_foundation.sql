-- NovaMe Burrow major update: rollout config, content catalog, atomic-economy
-- storage, inventory, gifts and room state. All mutations are service-role or
-- SECURITY DEFINER RPC only; authenticated users receive scoped read access.

insert into public.app_config(key, value, updated_by)
values
  ('app_major_update_enabled', 'false', 'migration-116'),
  ('app_major_update_content_revision', 'burrow-v1-placeholder', 'migration-116')
on conflict (key) do nothing;

create or replace function public.is_self_or_current_partner(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = p_owner_id
    or exists (
      select 1
      from public.pairings p
      join public.pairings q on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id
      where p.user_id = auth.uid()
        and p.partner_user_id = p_owner_id
    );
$$;

revoke all on function public.is_self_or_current_partner(uuid) from public, anon;
grant execute on function public.is_self_or_current_partner(uuid) to authenticated, service_role;

create or replace function public.can_read_burrow_pair(p_low uuid, p_high uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() in (p_low, p_high) and exists (
    select 1 from public.pairings p join public.pairings q
      on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id
    where p.user_id=p_low and p.partner_user_id=p_high
  );
$$;
revoke all on function public.can_read_burrow_pair(uuid,uuid) from public,anon;
grant execute on function public.can_read_burrow_pair(uuid,uuid) to authenticated,service_role;

-- Hold both pairing rows for the entire command so an unpair cannot race a
-- purchase, reward, photo update or other paired write.
create or replace function public.lock_burrow_pair(p_user uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
  select partner_user_id into partner from public.pairings where user_id=p_user;
  if partner is null then return null; end if;
  perform 1 from public.pairings where user_id in (p_user,partner) order by user_id for share;
  if not exists(select 1 from public.pairings where user_id=p_user and partner_user_id=partner)
    or not exists(select 1 from public.pairings where user_id=partner and partner_user_id=p_user)
  then return null; end if;
  -- One deterministic lock order for pair writes, including wallet -> quest
  -- event hooks and quest -> wallet claims. Avoid opposite-order deadlocks.
  perform public.lock_burrow_inventory(p_user,partner);
  return partner;
end $$;
revoke all on function public.lock_burrow_pair(uuid) from public,anon,authenticated;
grant execute on function public.lock_burrow_pair(uuid) to service_role;

create or replace function public.lock_burrow_inventory(p_a uuid,p_b uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||least(p_a,p_b)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('inventory:'||greatest(p_a,p_b)::text,0));
end $$;
revoke all on function public.lock_burrow_inventory(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lock_burrow_inventory(uuid,uuid) to service_role;

create table public.burrow_command_receipts (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  command_key text not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,command_key)
);
alter table public.burrow_command_receipts enable row level security;
create policy burrow_command_receipts_service on public.burrow_command_receipts
  for all to service_role using(true) with check(true);
grant all on public.burrow_command_receipts to service_role;

-- ---- Versioned, replaceable content ---------------------------------------

create table if not exists public.content_revisions (
  id text primary key,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  minimum_app_version text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.catalog_items (
  stable_id text primary key,
  revision_id text not null references public.content_revisions(id),
  item_type text not null,
  category text not null,
  title text not null,
  description text not null default '',
  price integer check (price is null or price >= 0),
  plus_only boolean not null default false,
  tradable boolean not null default true,
  tags text[] not null default '{}',
  drop_weight integer not null default 0 check (drop_weight >= 0),
  asset jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_placeholder boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_items_active_category
  on public.catalog_items(category, stable_id) where status = 'active';
create index if not exists catalog_items_drop_tags
  on public.catalog_items using gin(tags) where status = 'active' and drop_weight > 0;

alter table public.content_revisions enable row level security;
alter table public.catalog_items enable row level security;

drop policy if exists content_revisions_public_read on public.content_revisions;
create policy content_revisions_public_read on public.content_revisions
  for select to anon, authenticated using (status = 'published');
drop policy if exists content_revisions_service on public.content_revisions;
create policy content_revisions_service on public.content_revisions
  for all to service_role using (true) with check (true);

drop policy if exists catalog_items_public_read on public.catalog_items;
create policy catalog_items_public_read on public.catalog_items
  for select to anon, authenticated using (status = 'active' and exists(
    select 1 from public.content_revisions r where r.id=revision_id and r.status='published'
  ));
drop policy if exists catalog_items_service on public.catalog_items;
create policy catalog_items_service on public.catalog_items
  for all to service_role using (true) with check (true);

grant select on public.content_revisions, public.catalog_items to anon, authenticated;
grant all on public.content_revisions, public.catalog_items to service_role;

-- ---- Wallet and immutable ledger ------------------------------------------

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  carrot_balance integer not null default 0 check (carrot_balance between 0 and 99999),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.currency_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_delta integer not null check (requested_delta <> 0),
  delta integer not null,
  balance_after integer not null check (balance_after between 0 and 99999),
  reason text not null,
  reference_type text,
  reference_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);

create index if not exists currency_ledger_user_created
  on public.currency_ledger(user_id, created_at desc);

create table if not exists public.user_inventory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.catalog_items(stable_id),
  quantity integer not null default 1 check (quantity between 1 and 2),
  source text not null,
  source_reference_id text,
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, item_id)
);

create index if not exists user_inventory_owner_acquired
  on public.user_inventory(owner_id, acquired_at desc);

create table if not exists public.catalog_purchases (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.catalog_items(stable_id),
  price_snapshot integer not null check (price_snapshot >= 0),
  currency text not null default 'carrot_coin' check (currency = 'carrot_coin'),
  status text not null default 'completed' check (status in ('completed', 'refunded')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(buyer_id, idempotency_key)
);

create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.catalog_items(stable_id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'cancelled')),
  reference_type text,
  reference_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  check (sender_id <> recipient_id),
  unique(sender_id, idempotency_key)
);

create index if not exists gifts_recipient_pending
  on public.gifts(recipient_id, created_at desc) where status = 'pending';

create table if not exists public.iap_transactions (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('apple', 'google')),
  transaction_id text not null,
  product_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  verification_hash text not null,
  status text not null check (status in ('verified', 'credited', 'refunded', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, transaction_id)
);

alter table public.wallets enable row level security;
alter table public.currency_ledger enable row level security;
alter table public.user_inventory enable row level security;
alter table public.catalog_purchases enable row level security;
alter table public.gifts enable row level security;
alter table public.iap_transactions enable row level security;

drop policy if exists wallets_read_own on public.wallets;
create policy wallets_read_own on public.wallets
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists currency_ledger_read_own on public.currency_ledger;
create policy currency_ledger_read_own on public.currency_ledger
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists inventory_read_pair on public.user_inventory;
create policy inventory_read_pair on public.user_inventory
  for select to authenticated using (public.is_self_or_current_partner(owner_id));
drop policy if exists purchases_read_involved on public.catalog_purchases;
create policy purchases_read_involved on public.catalog_purchases
  for select to authenticated using (auth.uid() in (buyer_id, recipient_id));
drop policy if exists gifts_read_involved on public.gifts;
create policy gifts_read_involved on public.gifts
  for select to authenticated using (auth.uid() in (sender_id, recipient_id));
drop policy if exists iap_transactions_read_own on public.iap_transactions;
create policy iap_transactions_read_own on public.iap_transactions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists wallets_service on public.wallets;
create policy wallets_service on public.wallets for all to service_role using (true) with check (true);
drop policy if exists currency_ledger_service on public.currency_ledger;
create policy currency_ledger_service on public.currency_ledger for all to service_role using (true) with check (true);
drop policy if exists inventory_service on public.user_inventory;
create policy inventory_service on public.user_inventory for all to service_role using (true) with check (true);
drop policy if exists purchases_service on public.catalog_purchases;
create policy purchases_service on public.catalog_purchases for all to service_role using (true) with check (true);
drop policy if exists gifts_service on public.gifts;
create policy gifts_service on public.gifts for all to service_role using (true) with check (true);
drop policy if exists iap_transactions_service on public.iap_transactions;
create policy iap_transactions_service on public.iap_transactions for all to service_role using (true) with check (true);

grant select on public.wallets, public.currency_ledger, public.user_inventory,
  public.catalog_purchases, public.gifts, public.iap_transactions to authenticated;
grant all on public.wallets, public.currency_ledger, public.user_inventory,
  public.catalog_purchases, public.gifts, public.iap_transactions to service_role;

-- ---- Room state ------------------------------------------------------------

create table if not exists public.room_loadouts (
  id uuid primary key default gen_random_uuid(),
  room_type text not null check (room_type in ('home', 'our')),
  owner_id uuid references public.profiles(id) on delete cascade,
  pair_low uuid references public.profiles(id) on delete cascade,
  pair_high uuid references public.profiles(id) on delete cascade,
  slot text not null,
  item_id text not null references public.catalog_items(stable_id),
  transform jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_by uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  check (
    (room_type = 'home' and owner_id is not null and pair_low is null and pair_high is null)
    or
    (room_type = 'our' and owner_id is null and pair_low is not null and pair_high is not null and pair_low < pair_high)
  )
);

create unique index if not exists room_loadouts_home_slot
  on public.room_loadouts(owner_id, slot) where room_type = 'home';
create unique index if not exists room_loadouts_our_slot
  on public.room_loadouts(pair_low, pair_high, slot) where room_type = 'our';

create table if not exists public.room_needs (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  food_value smallint not null default 100 check (food_value between 0 and 100),
  food_updated_at timestamptz not null default now(),
  water_value smallint not null default 100 check (water_value between 0 and 100),
  water_updated_at timestamptz not null default now()
);

create table if not exists public.room_media (
  id uuid primary key default gen_random_uuid(),
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('frame', 'doll_low', 'doll_high')),
  private_storage_path text not null,
  crop jsonb not null default '{}'::jsonb,
  updated_by uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  check (pair_low < pair_high),
  unique(pair_low, pair_high, kind)
);

create table if not exists public.room_music (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  track_id text references public.catalog_items(stable_id),
  updated_at timestamptz not null default now()
);

alter table public.room_loadouts enable row level security;
alter table public.room_needs enable row level security;
alter table public.room_media enable row level security;
alter table public.room_music enable row level security;

drop policy if exists room_loadouts_read_pair on public.room_loadouts;
create policy room_loadouts_read_pair on public.room_loadouts
  for select to authenticated using (
    (room_type = 'home' and public.is_self_or_current_partner(owner_id))
    or (room_type = 'our' and public.can_read_burrow_pair(pair_low, pair_high))
  );
drop policy if exists room_needs_read_pair on public.room_needs;
create policy room_needs_read_pair on public.room_needs
  for select to authenticated using (public.is_self_or_current_partner(owner_id));
drop policy if exists room_media_read_pair on public.room_media;
create policy room_media_read_pair on public.room_media
  for select to authenticated using (public.can_read_burrow_pair(pair_low, pair_high));
drop policy if exists room_music_read_pair on public.room_music;
create policy room_music_read_pair on public.room_music
  for select to authenticated using (public.is_self_or_current_partner(owner_id));

drop policy if exists room_loadouts_service on public.room_loadouts;
create policy room_loadouts_service on public.room_loadouts for all to service_role using (true) with check (true);
drop policy if exists room_needs_service on public.room_needs;
create policy room_needs_service on public.room_needs for all to service_role using (true) with check (true);
drop policy if exists room_media_service on public.room_media;
create policy room_media_service on public.room_media for all to service_role using (true) with check (true);
drop policy if exists room_music_service on public.room_music;
create policy room_music_service on public.room_music for all to service_role using (true) with check (true);

grant select on public.room_loadouts, public.room_needs, public.room_media, public.room_music to authenticated;
grant all on public.room_loadouts, public.room_needs, public.room_media, public.room_music to service_role;

notify pgrst, 'reload schema';
