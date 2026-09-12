-- Editing in My Logs is intentionally body-only. Icons, Memory
-- copy, learning evidence and Connection insights belong to the original save
-- and must neither be regenerated nor retracted when wording is corrected.

-- A queued Connection job must also keep analyzing the text that was present
-- at the original save. Otherwise, a very fast edit could change the input of
-- an already queued job even though the edit itself did not enqueue new AI.
begin;

set local lock_timeout = '15s';
set local statement_timeout = '120s';

-- Connection workers read Reflect first and then claim/update the job. Take
-- locks in that same order so a live worker can finish instead of forming the
-- reverse-order deadlock seen during production rollout.
lock table public.reflects in access share mode;
lock table public.connection_analysis_jobs in access exclusive mode;

alter table public.connection_analysis_jobs
  add column if not exists source_body text;

update public.connection_analysis_jobs j
set source_body = r.body
from public.reflects r
where r.id = j.reflect_id and j.source_body is null;

create or replace function public.snapshot_connection_analysis_source_body()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_body is null then
    select body into new.source_body
    from public.reflects
    where id = new.reflect_id;
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_connection_analysis_source_body
  on public.connection_analysis_jobs;
create trigger snapshot_connection_analysis_source_body
before insert on public.connection_analysis_jobs
for each row execute function public.snapshot_connection_analysis_source_body();

revoke all on function public.snapshot_connection_analysis_source_body()
  from public, anon, authenticated;

comment on column public.connection_analysis_jobs.source_body is
  'Immutable Journal text captured when the original Connection job is enqueued.';

create or replace function public.edit_journal_body(
  p_user_id uuid,
  p_reflect_id uuid,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reflect public.reflects%rowtype;
begin
  if p_body is null or char_length(p_body) > 5000 then
    return jsonb_build_object('error', 'invalid_body');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_reflect
  from public.reflects
  where id = p_reflect_id and user_id = p_user_id
  for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_reflect.mode = 'typing' and btrim(p_body) = '' then
    return jsonb_build_object('error', 'empty');
  end if;

  update public.reflects
  set body = p_body
  where id = p_reflect_id and user_id = p_user_id;

  -- Keep durable recovery aligned without touching any generated columns.
  update public.reflect_drafts
  set body = p_body
  where user_id = p_user_id
    and (saved_reflect_id = p_reflect_id or finalized_reflect_id = p_reflect_id);

  return jsonb_build_object(
    'error', null,
    'reflect_id', p_reflect_id,
    'body', p_body,
    'local_date', v_reflect.local_date,
    'shared_to_friends', v_reflect.shared_to_friends
  );
end;
$$;

revoke all on function public.edit_journal_body(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.edit_journal_body(uuid, uuid, text)
  to service_role;

-- Retire the former destructive edit path. During a rolling deployment, an
-- older API now fails safely instead of rematching or retracting derivatives.
revoke execute on function public.edit_journal_entry(uuid, uuid, text, jsonb, jsonb, boolean)
  from service_role;

notify pgrst, 'reload schema';

commit;
