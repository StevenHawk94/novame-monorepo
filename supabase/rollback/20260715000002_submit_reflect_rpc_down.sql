-- Rollback for 20260715000002. Drops the function; no data is affected (it
-- writes rows but owns no schema objects of its own).
drop function if exists public.submit_reflect(uuid, smallint, text, date, text, int, jsonb);
