-- New journeys only: Free 6 hours, Plus 2 hours. Never rewrite an existing
-- started_at/ends_at or change pairing, rewards, daily limits or settlement.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Patch only the duration literal in the existing protected writers. Retain
-- their exact authorization, idempotency, subscription and receipt logic,
-- function identities, security configuration and grants.
do $$
declare target regprocedure; original text; updated text;
begin
  foreach target in array array[
    'public.start_adventure_v1(uuid,uuid,text)'::regprocedure,
    'public.solo_burrow_start_adventure_v1(uuid,uuid,text)'::regprocedure
  ] loop
    original:=pg_get_functiondef(target);
    if strpos(original,'then 7200 else 28800')=0 and strpos(original,'then 7200 else 21600')=0 then
      raise exception 'Unexpected Adventure duration writer: %',target;
    end if;
    updated:=replace(original,'then 7200 else 28800','then 7200 else 21600');
    if replace(updated,'then 7200 else 21600','then 7200 else 28800')<>replace(original,'then 7200 else 21600','then 7200 else 28800') then
      raise exception 'Unexpected Adventure function change: %',target;
    end if;
    execute updated;
  end loop;
end $$;

-- The temporary INSERT override forcibly shortened both tiers to one minute.
-- Removing it restores the writers' production dates and matching receipts.
drop trigger if exists burrow_test_adventure_duration on public.adventures;
drop function if exists public.burrow_test_adventure_duration_v1();

notify pgrst,'reload schema';
commit;
