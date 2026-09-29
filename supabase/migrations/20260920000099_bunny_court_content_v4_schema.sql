-- Bunny Court v4 schema. Run before all numbered content parts.
-- New content remains staged until the final activation migration.
alter table public.court_case_definitions add column if not exists subcategory text;
alter table public.court_verdict_templates add column if not exists aha_tool text;
alter table public.court_verdict_templates add column if not exists role_note text;
alter table public.court_verdict_templates add column if not exists action_a text;
alter table public.court_verdict_templates add column if not exists action_b text;
alter table public.court_verdict_templates add column if not exists try_together text;
alter table public.court_verdict_templates add column if not exists closing text;
alter table public.court_verdicts add column if not exists action_a text;
alter table public.court_verdicts add column if not exists action_b text;
alter table public.court_verdicts add column if not exists action_a_name text;
alter table public.court_verdicts add column if not exists action_b_name text;
alter table public.court_verdicts add column if not exists try_together text;
alter table public.court_verdicts add column if not exists closing text;
