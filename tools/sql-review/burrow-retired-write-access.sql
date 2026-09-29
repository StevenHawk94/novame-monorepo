-- READ ONLY. Run on an isolated staging database after the complete migration
-- chain. An empty first result is expected; never blindly revoke every function.
-- Includes overloads left by older migrations, not just the latest signatures.
select p.oid::regprocedure as exposed_function, r.rolname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join pg_roles r
where n.nspname='public' and r.rolname in('anon','authenticated')
and p.proname in(
 'submit_reflect','submit_reflect_with_kind','begin_saved_reflect','finalize_reflect_draft',
 'complete_saved_reflect','claim_reflect_ai_enhancement','submit_kit','submit_true_north',
 'pop_bubble','pop_bubble_pre_burrow_v1','begin_saved_reflect_pre_share_v1',
 'set_burrow_record_sharing_v1','set_burrow_record_sharing_v2','apply_burrow_coin_purchase_v1',
 'submit_tame_enemy','check_quest_task','claim_quest_rewards_v2',
 'change_carrot_balance_v1','claim_daily_quest_v1','claim_special_quest_v1',
 'prepare_room_photo_v1','complete_room_photo_v1','collect_room_photo_garbage_v1',
 'prepare_room_photo_before_expiry_v1','complete_room_photo_before_expiry_v1'
)
and has_function_privilege(r.oid,p.oid,'EXECUTE')
order by 1,2;

-- Security-definer exposure inventory for manual review; some explicitly
-- granted read helpers may be intentional. This does not mutate grants.
select p.oid::regprocedure as function_name,p.proconfig as function_settings,r.rolname
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join pg_roles r
where n.nspname='public' and p.prosecdef and r.rolname in('anon','authenticated')
and has_function_privilege(r.oid,p.oid,'EXECUTE')
and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
order by 1,3;
