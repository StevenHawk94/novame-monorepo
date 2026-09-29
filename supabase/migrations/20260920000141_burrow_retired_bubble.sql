-- API guard alone cannot protect old server versions during rolling deploys.
alter function public.pop_bubble(uuid,uuid,text,date,text,integer,integer) rename to pop_bubble_pre_burrow_v1;
create function public.pop_bubble(p_user_id uuid,p_friend_user_id uuid,p_item_id text,p_local_date date,p_iso_week text,p_amount integer,p_daily_cap integer)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'))
   then return jsonb_build_object('error','feature_retired'); end if;
 return pop_bubble_pre_burrow_v1(p_user_id,p_friend_user_id,p_item_id,p_local_date,p_iso_week,p_amount,p_daily_cap);
end $$;
revoke all on function public.pop_bubble(uuid,uuid,text,date,text,integer,integer),
 public.pop_bubble_pre_burrow_v1(uuid,uuid,text,date,text,integer,integer) from public,anon,authenticated;
grant execute on function public.pop_bubble(uuid,uuid,text,date,text,integer,integer) to service_role;
notify pgrst,'reload schema';
