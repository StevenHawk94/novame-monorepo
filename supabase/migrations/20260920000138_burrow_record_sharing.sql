-- New records only. Never backfill private historical diaries into a feed.
create table public.burrow_record_sharing(
 record_id uuid primary key references reflects(id) on delete cascade,
 author_id uuid not null references profiles(id) on delete cascade,
 pair_low uuid not null references profiles(id) on delete cascade,
 pair_high uuid not null references profiles(id) on delete cascade,
 shared boolean not null default true,
 updated_at timestamptz not null default now(),check(pair_low<pair_high)
);
alter table public.burrow_record_sharing enable row level security;
revoke all on public.burrow_record_sharing from public,anon,authenticated;
grant all on public.burrow_record_sharing to service_role;
create trigger burrow_change after insert or update or delete on public.burrow_record_sharing
for each row execute function public.broadcast_burrow_change();

alter function public.begin_saved_reflect(uuid,jsonb,jsonb,integer,text) rename to begin_saved_reflect_pre_share_v1;
create function public.begin_saved_reflect(p_user_id uuid,p_payload jsonb,p_memories jsonb,p_xp integer,p_week text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; partner uuid; old_saved boolean; record_id uuid;
begin
 if not exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1')) then
   return begin_saved_reflect_pre_share_v1(p_user_id,p_payload,p_memories,p_xp,p_week);
 end if;
 partner:=lock_burrow_pair(p_user_id);
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 select exists(select 1 from reflect_drafts where user_id=p_user_id and idempotency_key=p_payload->>'idempotency_key'
   and (saved_reflect_id is not null or finalized_reflect_id is not null)) into old_saved;
 result:=begin_saved_reflect_pre_share_v1(p_user_id,p_payload,p_memories,p_xp,p_week);
 if result->>'error' is not null or old_saved or partner is null then return result; end if;
 record_id:=(result->'draft'->>'saved_reflect_id')::uuid;
 if record_id is not null then
   insert into burrow_record_sharing(record_id,author_id,pair_low,pair_high,shared)
   values(record_id,p_user_id,least(p_user_id,partner),greatest(p_user_id,partner),coalesce((p_payload->>'share_to_partner')::boolean,true));
 end if;
 return result;
end $$;
revoke all on function public.begin_saved_reflect(uuid,jsonb,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.begin_saved_reflect(uuid,jsonb,jsonb,integer,text) to service_role;

-- Legacy readers must not gain access via a broad shared_to_friends flag.
create function public.keep_burrow_diary_pair_private() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from burrow_record_sharing where record_id=new.id) then
   new.shared_to_friends:=false; new.shared_with_user_id:=null;
 end if;return new;
end $$;
revoke all on function public.keep_burrow_diary_pair_private() from public,anon,authenticated;
create trigger keep_burrow_diary_pair_private before update on reflects for each row execute function public.keep_burrow_diary_pair_private();

create function public.set_burrow_record_sharing_v1(p_user_id uuid,p_record_id uuid,p_shared boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if p_shared is null then return jsonb_build_object('error','invalid_request'); end if;
 update burrow_record_sharing set shared=p_shared,updated_at=now() where record_id=p_record_id and author_id=p_user_id
   and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner);
 if not found then return jsonb_build_object('error','not_found'); end if;
 update moment_events set visibility=case when p_shared then 'pair' else 'actor_only' end
   where actor_id=p_user_id and reference_type='reflect' and reference_id=p_record_id::text;
 return jsonb_build_object('error',null,'shared',p_shared);
end $$;
revoke all on function public.set_burrow_record_sharing_v1(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_burrow_record_sharing_v1(uuid,uuid,boolean) to service_role;

create function public.burrow_record_moment_visibility() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.reference_type='reflect' and exists(select 1 from burrow_record_sharing where record_id::text=new.reference_id and not shared)
   then new.visibility:='actor_only'; end if;return new;
end $$;
revoke all on function public.burrow_record_moment_visibility() from public,anon,authenticated;
create trigger burrow_record_moment_visibility before insert on moment_events for each row execute function public.burrow_record_moment_visibility();

-- A scoped projection; no storage paths, raw excerpts, or private item copy.
create function public.burrow_shared_record_v1(p_viewer uuid,p_reference text,p_low uuid,p_high uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 select jsonb_build_object('id',r.id,'body',r.body,'shared',s.shared,'items',
   coalesce((select jsonb_agg(jsonb_build_object('itemId',i.item_id,'label',coalesce(to_jsonb(i)->>'match_label',i.item_id),
     'memory',case when coalesce((to_jsonb(i)->>'visible_to_paired')::boolean,false) then
       (select m.description from item_memories m where m.reflect_id=r.id and m.user_id=r.user_id and m.item_id=i.item_id order by m.created_at,m.id limit 1) end)
     order by i.item_id) from reflect_items i where i.reflect_id=r.id and i.user_id=r.user_id),'[]')) into result
 from burrow_record_sharing s join reflects r on r.id=s.record_id
 where r.id::text=p_reference and s.pair_low=p_low and s.pair_high=p_high
   and p_viewer in(p_low,p_high) and (s.shared or s.author_id=p_viewer);
 return result;
end $$;
revoke all on function public.burrow_shared_record_v1(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.burrow_shared_record_v1(uuid,text,uuid,uuid) to service_role;
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
      select id,actor_id,event_type,reference_id,reference_type,created_at,payload,case when reference_type='reflect' then burrow_shared_record_v1(p_user_id,reference_id,lo,hi) end as record,(created_at at time zone tz)::date as "localDate"
      from moment_events where pair_low=lo and pair_high=hi and (visibility='pair' or actor_id=p_user_id)
        and (reference_type is distinct from 'reflect' or not exists(select 1 from burrow_record_sharing s where s.record_id::text=reference_id and not s.shared and s.author_id<>p_user_id))
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
notify pgrst,'reload schema';
