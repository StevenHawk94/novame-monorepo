begin;
-- Additive only: existing announcements/read receipts and old clients survive.
alter table public.app_announcements add column if not exists button_text text not null default 'Continue';
alter table public.app_announcements add column if not exists action_url text;
alter table public.app_announcements add constraint announcement_button_text_valid
 check (length(btrim(button_text)) between 1 and 60);
alter table public.app_announcements add constraint announcement_action_url_valid
 check (action_url is null or (length(action_url)<=2048 and action_url ~* '^https://[^[:space:]]+$'));
commit;
