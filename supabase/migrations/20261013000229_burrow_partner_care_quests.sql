-- Helping with a partner's care completes their matching assigned daily quest.
-- Keep existing actor progress; do not auto-claim either account's reward.
begin;
create or replace function public.burrow_moment_quest_progress()
returns trigger language plpgsql security definer set search_path=public as $$
declare quest text; partner uuid;
begin
 quest:=case new.event_type
  when 'affection_sent' then 'send_affection'
  when 'adventure_record_saved' then 'write_adventure_record'
  when 'game_played' then 'play_game'
  when 'toy_interacted' then 'interact_with_toy'
  when 'room_need_refilled' then case new.payload->>'need'
   when 'water' then 'water_partner_flower' when 'food' then 'feed_partner_bunny' end
  else null end;
 if quest is not null then
  partner:=lock_burrow_pair(new.actor_id);
  -- Pair writers acquire the canonical inventory locks before firing this hook.
  -- Both assignments use their own profile timezone, not the helper's date.
  perform public.assign_daily_quests_v1(new.actor_id);
  perform public.advance_daily_quest_v1(new.actor_id,quest,1);
  if new.event_type='room_need_refilled' and new.target_id is not null and new.target_id<>new.actor_id then
   if partner=new.target_id and new.pair_low=least(new.actor_id,new.target_id)
    and new.pair_high=greatest(new.actor_id,new.target_id) then
    perform public.assign_daily_quests_v1(new.target_id);
    perform public.advance_daily_quest_v1(new.target_id,quest,1);
   end if;
  end if;
 end if;
 return new;
end $$;
-- The underlying touch counter/idempotent receipts stay unchanged. A named
-- owner can never be redirected to a partner or an unrelated account.
create function public.interact_burrow_toy_v2(p_user_id uuid,p_owner_id uuid,p_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_owner_id is distinct from p_user_id then return jsonb_build_object('error','own_toy_only'); end if;
 return public.interact_burrow_toy_v1(p_user_id,p_key);
end $$;
-- New own-toy activity identifies the actual room owner; retain older events.
do $$ declare original text; revised text; begin
 original:=pg_get_functiondef('public.interact_burrow_toy_v1(uuid,text)'::regprocedure);
 revised:=replace(original,'greatest(p_user_id,partner),p_user_id,partner,',
  'greatest(p_user_id,partner),p_user_id,p_user_id,');
 if revised=original then raise exception 'Unexpected toy activity definition'; end if;
 revised:=replace(revised,'on conflict(actor_id,idempotency_key) do update set',
  'on conflict(actor_id,idempotency_key) do update set target_id=excluded.target_id,');
 execute revised;
end $$;
-- History previously discarded the room owner, making help look like self-care.
-- Add just that column; preserve pagination, pairing and private-record guards.
do $$ declare signature text; original text; revised text; begin
 foreach signature in array array['public.burrow_history_v1(uuid,uuid,text,timestamptz,uuid,date)',
  'public.solo_burrow_history_v1(uuid,text,timestamptz,uuid,date)'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  if position('select id,actor_id,target_id,event_type' in original)>0 then continue; end if;
  revised:=replace(original,'select id,actor_id,event_type,','select id,actor_id,target_id,event_type,');
  if revised=original then raise exception 'Unexpected Moments history definition: %',signature; end if;
  execute revised;
 end loop;
end $$;
revoke all on function public.burrow_moment_quest_progress(),public.interact_burrow_toy_v2(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.interact_burrow_toy_v2(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
