-- Private invalidation only. Never broadcast diaries, photos or inventory rows.
do $$ begin
 if to_regclass('realtime.messages') is not null then
   execute 'create policy burrow_broadcast_receive_own on realtime.messages for select to authenticated using (realtime.topic() = ''burrow:'' || auth.uid()::text)';
 end if;
end $$;
create function public.broadcast_burrow_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data jsonb; old_data jsonb; target uuid; targets uuid[]; owner uuid; partner uuid; event_name text;
begin
 if tg_op='UPDATE' and new is not distinct from old then return new; end if;
 if tg_op='DELETE' then row_data:=to_jsonb(old); else row_data:=to_jsonb(new); end if;
 if tg_op='UPDATE' then old_data:=to_jsonb(old); end if;
 event_name:=case when tg_table_name='pairings' then 'pair_changed' else 'burrow_changed' end;
 if tg_table_name='memory_entry_photos' then
   select pair_low,pair_high into owner,partner from memory_room_entries where id=(row_data->>'entry_id')::uuid;
   targets:=array[owner,partner];
 elsif row_data->>'pair_low' is not null then targets:=array[(row_data->>'pair_low')::uuid,(row_data->>'pair_high')::uuid];
 elsif tg_table_name in ('gifts','affection_events') then targets:=array[(row_data->>'sender_id')::uuid,(row_data->>'recipient_id')::uuid];
 else
   owner:=coalesce((row_data->>'owner_id')::uuid,(row_data->>'user_id')::uuid,
     case when tg_table_name='profiles' then (row_data->>'id')::uuid end);
   select partner_user_id into partner from pairings where user_id=owner;
   targets:=array[owner,partner,(row_data->>'partner_id')::uuid,(row_data->>'partner_user_id')::uuid,
     (old_data->>'partner_user_id')::uuid];
 end if;
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
   for target in select distinct x from unnest(targets) x where x is not null loop
     perform realtime.send('{}'::jsonb,event_name,'burrow:'||target::text,true);
   end loop;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function broadcast_burrow_change() from public,anon,authenticated;
-- Business rows only; bootstrap reads, receipts and upload tickets do not emit.
do $$ declare tab text; begin
 foreach tab in array array['pairings','profiles','wallets','user_inventory','gifts','affection_events','room_loadouts','room_needs',
   'room_music','room_photos','shared_room_state','friend_visits','adventures','memory_room_entries','memory_entry_photos','moment_events'] loop
   execute format('create trigger burrow_change after insert or update or delete on public.%I for each row execute function public.broadcast_burrow_change()',tab);
 end loop;
end $$;

-- Bound replay to the original pair and protect edits from cross-device loss.
create function public.save_memory_room_durable_v1(p_user_id uuid,p_partner_id uuid,p_entry_id uuid,p_body text,p_prompt_id text,p_key text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; current_version timestamptz;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if p_partner_id is distinct from partner then return jsonb_build_object('error','pair_changed'); end if;
 -- Receipt replay must precede version check: a lost response already changed
 -- updated_at. The underlying RPC verifies the full original request.
 if exists(select 1 from burrow_command_receipts where actor_id=p_user_id and command_key='memory:'||p_key)
   then return save_memory_room_entry_v1(p_user_id,p_entry_id,p_body,p_prompt_id,p_key); end if;
 if p_entry_id is not null then
   select updated_at into current_version from memory_room_entries where id=p_entry_id and author_id=p_user_id
     and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) and deleted_at is null for update;
   if not found then return jsonb_build_object('error','not_found'); end if;
   if p_expected_updated_at is null or current_version<>p_expected_updated_at then return jsonb_build_object('error','memory_conflict'); end if;
 end if;
 return save_memory_room_entry_v1(p_user_id,p_entry_id,p_body,p_prompt_id,p_key);
end $$;
revoke all on function save_memory_room_durable_v1(uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function save_memory_room_durable_v1(uuid,uuid,uuid,text,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
