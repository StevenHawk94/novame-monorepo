-- Retain compact, privacy-safe evidence separately from generated Connection
-- cards so future analysis can reason over trends without resending card copy.
alter table public.reflect_ai_analyses
  add column if not exists connection_signals jsonb not null default '[]'::jsonb;

alter table public.reflect_ai_analyses
  drop constraint if exists reflect_ai_analyses_connection_signals_array;
alter table public.reflect_ai_analyses
  add constraint reflect_ai_analyses_connection_signals_array
  check (jsonb_typeof(connection_signals) = 'array');

comment on column public.reflect_ai_analyses.connection_signals is
  'Compact privacy-safe Connection evidence retained for a 30-day analysis window.';
