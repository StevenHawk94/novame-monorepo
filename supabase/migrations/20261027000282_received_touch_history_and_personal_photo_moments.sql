-- Approved: history is recipient-only (retention remains shared latest 10).
-- Ordinary interactions may prove the actor's retained personal doll photo,
-- regardless of the relationship under which that photo was uploaded.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $history$
declare target regprocedure; original text; old_clause text; new_clause text;
begin
 for target,old_clause,new_clause in select * from (values
  ('public.plushie_touch_state_v2(uuid,text)'::regprocedure,
   '((m.recipient_id=p_user and m.sender_id=partner) or (plus and m.sender_id=p_user and m.recipient_id=partner))',
   '(m.recipient_id=p_user and m.sender_id=partner)'),
  ('public.read_plushie_touch_v2(uuid,text,uuid,boolean)'::regprocedure,
   '((recipient_id=p_user and sender_id=partner) or (sender_id=p_user and recipient_id=partner and burrow_has_plus_v1(p_user) and same_economic_domain_v1(p_user,partner)))',
   '(recipient_id=p_user and sender_id=partner)')
 ) v loop
  original:=pg_get_functiondef(target);
  if (length(original)-length(replace(original,old_clause,'')))/length(old_clause)<>1 then
   raise exception 'Unexpected Touch Note history implementation: %',target;
  end if;
  execute replace(original,old_clause,new_clause);
 end loop;
end $history$;

do $moments$
declare target regprocedure; original text; old_clause text; new_clause text;
begin
 target:='public.record_burrow_toy_window_v1(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz,date,integer,text,text)'::regprocedure;
 original:=pg_get_functiondef(target);
 old_clause:='and pair_low=lo and pair_high=hi and kind=''doll'' and toy_id=p_toy_id';
 new_clause:='and kind=''doll'' and toy_id=p_toy_id';
 if (length(original)-length(replace(original,old_clause,'')))/length(old_clause)<>1 then
  raise exception 'Unexpected personal toy window implementation';
 end if;
 execute replace(original,old_clause,new_clause);
 -- Legacy adapters select only the equipped personal toy. Keep that rule,
 -- but do not discard its retained owner photo because its upload pair is old.
 for target,old_clause in select * from (values
  ('public.interact_burrow_toy_batch_v1(uuid,uuid,uuid,text,date,integer,text)'::regprocedure,
   'and pair_low=least(p_user_id,coalesce(p_partner_id,p_user_id)) and pair_high=greatest(p_user_id,coalesce(p_partner_id,p_user_id))'),
  ('public.interact_burrow_toy_v1(uuid,text)'::regprocedure,
   'and pair_low=least(p_user_id,coalesce(partner,p_user_id)) and pair_high=greatest(p_user_id,coalesce(partner,p_user_id))')
 ) v loop
  original:=pg_get_functiondef(target);
  if (length(original)-length(replace(original,old_clause,'')))/length(old_clause)<>1 then
   raise exception 'Unexpected personal toy adapter: %',target;
  end if;
  execute replace(original,old_clause,'');
 end loop;
end $moments$;
-- No message pruning, quota changes, photo writes or old receipt rewriting.
-- CREATE OR REPLACE preserves each function's existing grants.
notify pgrst,'reload schema';
commit;
