-- Keyset history, scoped to the current reciprocal pair on every page.
create index if not exists burrow_moments_history on public.moment_events(pair_low,pair_high,created_at desc,id desc);
create index if not exists burrow_memories_history on public.memory_room_entries(pair_low,pair_high,created_at desc,id desc) where deleted_at is null;
create or replace function public.burrow_history_v1(
  p_user_id uuid,p_partner_id uuid,p_kind text,p_before timestamptz default null,
  p_before_id uuid default null,p_date date default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid; hi uuid; tz text; rows jsonb; last_row jsonb; more boolean;
begin
  if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
    then return jsonb_build_object('error','feature_disabled'); end if;
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if partner is distinct from p_partner_id then return jsonb_build_object('error','pair_changed'); end if;
  if p_kind not in('moments','memories') or p_kind is null or (p_before is null)<>(p_before_id is null)
    then return jsonb_build_object('error','invalid_request'); end if;
  lo:=least(p_user_id,partner);hi:=greatest(p_user_id,partner);
  select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where id=p_user_id;
  if p_kind='moments' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]') into rows from (
      select id,actor_id,event_type,reference_id,reference_type,created_at,payload,(created_at at time zone tz)::date as "localDate"
      from moment_events where pair_low=lo and pair_high=hi and (visibility='pair' or actor_id=p_user_id)
        and (p_before is null or (created_at,id)<(p_before,p_before_id))
        and (p_date is null or (created_at at time zone tz)::date=p_date)
      order by created_at desc,id desc limit 31
    ) r;
  else
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]') into rows from (
      select e.id,e.author_id,e.body,e.prompt_id,e.created_at,e.updated_at,
        (e.created_at at time zone tz)::date as "localDate",
        coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slot',p.slot,'updatedAt',p.updated_at) order by p.slot)
          from memory_entry_photos p where p.entry_id=e.id),'[]') as photos
      from memory_room_entries e where pair_low=lo and pair_high=hi and deleted_at is null
        and (p_before is null or (e.created_at,e.id)<(p_before,p_before_id))
        and (p_date is null or (e.created_at at time zone tz)::date=p_date)
      order by e.created_at desc,e.id desc limit 31
    ) r;
  end if;
  more:=jsonb_array_length(rows)>30;
  if more then rows:=rows-30; end if;
  last_row:=rows->(jsonb_array_length(rows)-1);
  return jsonb_build_object('rows',rows,'hasMore',more,'timezone',tz,
    'next',case when more then jsonb_build_object('at',last_row->>'created_at','id',last_row->>'id') else null end);
end $$;
revoke all on function public.burrow_history_v1(uuid,uuid,text,timestamptz,uuid,date) from public,anon,authenticated;
grant execute on function public.burrow_history_v1(uuid,uuid,text,timestamptz,uuid,date) to service_role;
notify pgrst,'reload schema';
