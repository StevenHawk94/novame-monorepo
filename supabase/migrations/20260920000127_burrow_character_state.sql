-- Replaceable code-native outfit variants. No art downloads or rollout change.
update public.catalog_items set asset=asset||'{"renderer":"native_bunny","outfitStyle":"explorer","outfitColor":"#65845B"}'::jsonb
 where stable_id='outfit_explorer_01';
insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,price,plus_only,tradable,asset,metadata,is_placeholder)
values
 ('placeholder_outfit_cozy_01','burrow-v1-placeholder','outfit','outfits','Cozy Jumper','Replaceable knitwear placeholder.',90,false,true,
  '{"renderer":"native_bunny","outfitStyle":"jumper","outfitColor":"#D88273"}','{"slot":"outfit"}',true),
 ('placeholder_outfit_rain_01','burrow-v1-placeholder','outfit','outfits','Rainy Day Coat','Replaceable raincoat placeholder.',120,false,true,
  '{"renderer":"native_bunny","outfitStyle":"raincoat","outfitColor":"#E6B645"}','{"slot":"outfit"}',true),
 ('placeholder_outfit_night_01','burrow-v1-placeholder','outfit','outfits','Starlight Pyjamas','Replaceable pyjama placeholder.',160,false,true,
  '{"renderer":"native_bunny","outfitStyle":"pyjamas","outfitColor":"#6C7CAF"}','{"slot":"outfit"}',true);

alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_adventure_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; partner uuid;
begin
 result:=burrow_bootstrap_adventure_v1(p_user_id);
 if result->>'error' is not null then return result; end if;
 partner:=(result->'partner'->>'id')::uuid;
 -- Pair lock is held by the wrapped bootstrap. Expose only public room state,
 -- never the partner's diary, source tags, result content or request key.
 return result||jsonb_build_object(
  'partnerAdventure',(select jsonb_build_object('id',id,'status',status,'started_at',started_at,'ends_at',ends_at)
    from adventures where user_id=partner and partner_id=p_user_id
    and status in('in_progress','result_ready','interaction_required') order by created_at desc limit 1),
  'roomNeeds',(result->'roomNeeds')||coalesce((select jsonb_build_object('foodValue',food_value,'waterValue',water_value,
    'foodUpdatedAt',food_updated_at,'waterUpdatedAt',water_updated_at) from room_needs where owner_id=p_user_id),'{}'::jsonb),
  'partnerNeeds',(result->'partnerNeeds')||coalesce((select jsonb_build_object('foodValue',food_value,'waterValue',water_value,
    'foodUpdatedAt',food_updated_at,'waterUpdatedAt',water_updated_at) from room_needs where owner_id=partner),'{}'::jsonb));
end $$;
revoke all on function public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.burrow_bootstrap_v1(uuid) to service_role;
notify pgrst,'reload schema';
