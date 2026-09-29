-- Privacy writes are versioned, pair-generation bound and replay-safe.
alter table public.burrow_record_sharing add column version bigint not null default 0;
create function public.set_burrow_record_sharing_v2(p_user_id uuid,p_partner_id uuid,p_pair_version text,
 p_record_id uuid,p_shared boolean,p_expected_version bigint,p_key text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; current_version bigint; request jsonb; receipt burrow_command_receipts%rowtype; result jsonb;
begin
 if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1')) then return jsonb_build_object('error','feature_disabled'); end if;
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if partner is distinct from p_partner_id or p_pair_version is null or p_pair_version is distinct from burrow_pair_version_v1(p_user_id,partner)
   then return jsonb_build_object('error','pair_changed'); end if;
 if p_shared is null or p_expected_version is null or p_expected_version<0 or nullif(trim(p_key),'') is null or length(p_key)>100
   then return jsonb_build_object('error','invalid_request'); end if;
 request:=jsonb_build_object('partner',partner,'pairVersion',p_pair_version,'record',p_record_id,'shared',p_shared,'version',p_expected_version);
 select * into receipt from burrow_command_receipts where actor_id=p_user_id and command_key='record-share:'||p_key;
 if found then
   if receipt.request<>request then return jsonb_build_object('error','idempotency_conflict'); end if;
   return receipt.response; -- Never reapply an old share after a newer withdrawal.
 end if;
 select version into current_version from burrow_record_sharing where record_id=p_record_id and author_id=p_user_id
   and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if current_version<>p_expected_version then return jsonb_build_object('error','sharing_conflict'); end if;
 update burrow_record_sharing set shared=p_shared,version=version+1,updated_at=clock_timestamp() where record_id=p_record_id;
 update moment_events set visibility=case when p_shared then 'pair' else 'actor_only' end
   where actor_id=p_user_id and reference_type='reflect' and reference_id=p_record_id::text;
 result:=jsonb_build_object('error',null,'shared',p_shared,'version',current_version+1);
 insert into burrow_command_receipts(actor_id,command_key,request,response) values(p_user_id,'record-share:'||p_key,request,result);
 return result;
end $$;
revoke all on function public.set_burrow_record_sharing_v2(uuid,uuid,text,uuid,boolean,bigint,text) from public,anon,authenticated;
grant execute on function public.set_burrow_record_sharing_v2(uuid,uuid,text,uuid,boolean,bigint,text) to service_role;
-- Old API instances cannot bypass conflict checks during a rolling deploy.
create or replace function public.set_burrow_record_sharing_v1(p_user_id uuid,p_record_id uuid,p_shared boolean) returns jsonb
language sql security definer set search_path=public as $$ select jsonb_build_object('error','client_upgrade_required') $$;
alter function public.burrow_shared_record_v1(uuid,text,uuid,uuid) rename to burrow_shared_record_pre_version_v1;
create function public.burrow_shared_record_v1(p_viewer uuid,p_reference text,p_low uuid,p_high uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select burrow_shared_record_pre_version_v1(p_viewer,p_reference,p_low,p_high)
   || jsonb_build_object('version',version) from burrow_record_sharing where record_id::text=p_reference
$$;
revoke all on function public.burrow_shared_record_v1(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_shared_record_v1(uuid,text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
