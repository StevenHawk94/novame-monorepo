alter table public.app_announcements
  add column if not exists image_url text;

comment on column public.app_announcements.image_url is
  'Public R2 URL for the announcement image; mobile only displays after prefetch succeeds.';
