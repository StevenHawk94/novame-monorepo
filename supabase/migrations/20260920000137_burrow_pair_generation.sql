-- Relationship identity must change even when the same two people reconnect.
create table public.burrow_pair_versions(user_id uuid primary key references profiles(id) on delete cascade,version uuid not null default gen_random_uuid());
alter table public.burrow_pair_versions enable row level security;
revoke all on public.burrow_pair_versions from public,anon,authenticated;
grant all on public.burrow_pair_versions to service_role;
insert into burrow_pair_versions(user_id) select id from profiles;
create function public.rotate_burrow_pair_version() returns trigger language plpgsql security definer set search_path=public as $$
declare who uuid;
begin
 if tg_op='UPDATE' and old.partner_user_id is not distinct from new.partner_user_id then return new; end if;
 who:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 if exists(select 1 from profiles where id=who) then
   insert into burrow_pair_versions(user_id) values(who) on conflict(user_id) do update set version=gen_random_uuid();
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.rotate_burrow_pair_version() from public,anon,authenticated;
create trigger burrow_pair_version after insert or update of partner_user_id or delete on public.pairings
for each row execute function public.rotate_burrow_pair_version();
create function public.burrow_pair_version_v1(p_user_id uuid,p_partner_id uuid) returns text
language sql stable security definer set search_path=public as $$
 select md5(string_agg(user_id::text||':'||version::text,',' order by user_id))
 from burrow_pair_versions where user_id in(p_user_id,p_partner_id) having count(*)=2;
$$;
revoke all on function public.burrow_pair_version_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_pair_version_v1(uuid,uuid) to service_role;
alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_pre_generation_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=burrow_bootstrap_pre_generation_v1(p_user_id);
 if result->>'error' is not null then return result; end if;
 return result||jsonb_build_object('pairVersion',burrow_pair_version_v1(p_user_id,(result->'partner'->>'id')::uuid));
end $$;
revoke all on function public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.burrow_bootstrap_v1(uuid) to service_role;
create function public.save_memory_room_versioned_v1(p_user_id uuid,p_partner_id uuid,p_pair_version text,p_entry_id uuid,p_body text,p_prompt_id text,p_key text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if partner is distinct from p_partner_id or p_pair_version is null or p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
   then return jsonb_build_object('error','pair_changed'); end if;
 return save_memory_room_durable_v1(p_user_id,p_partner_id,p_entry_id,p_body,p_prompt_id,p_key,p_expected_updated_at);
end $$;
revoke all on function public.save_memory_room_versioned_v1(uuid,uuid,text,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_memory_room_versioned_v1(uuid,uuid,text,uuid,text,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
