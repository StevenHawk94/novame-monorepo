-- Make the conditional 1/2/3-call Connection pipeline observable and
-- recoverable without treating router evidence as a fully generated card.

alter table public.reflect_ai_analyses
  add column if not exists connection_pipeline_status text not null default 'completed';

alter table public.reflect_ai_analyses
  drop constraint if exists reflect_ai_analyses_connection_pipeline_status_check;
alter table public.reflect_ai_analyses
  add constraint reflect_ai_analyses_connection_pipeline_status_check
  check (connection_pipeline_status in (
    'router_completed', 'deferred', 'retrying', 'partial',
    'completed', 'no_update', 'failed'
  ));

alter table public.connection_analysis_jobs
  add column if not exists failure_stage text;

comment on column public.reflect_ai_analyses.connection_pipeline_status is
  'Durable Connection stage; legacy status remains completed so retained router evidence stays queryable.';
comment on column public.connection_analysis_jobs.failure_stage is
  'Privacy-safe failing pipeline boundary, without Journal or generated copy.';

-- Repair observability for already-exhausted writer jobs. Do not requeue here:
-- migrations can run before the matching API deployment, so replay is a
-- separate post-deploy operation.
update public.reflect_ai_analyses a
set connection_pipeline_status = 'failed',
    error = j.error
from public.connection_analysis_jobs j
where j.reflect_id = a.reflect_id
  and j.status = 'failed'
  and a.connection_updates is null;
