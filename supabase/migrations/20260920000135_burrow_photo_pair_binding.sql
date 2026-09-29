-- Bind a restored local photo draft to its original partner in the same
-- transaction as ticket preparation. Never re-target it after an unpair.
create function public.prepare_burrow_photo_for_pair_v1(p_user_id uuid,p_partner_id uuid,p_target jsonb,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
  partner:=lock_burrow_pair(p_user_id);
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if partner is distinct from p_partner_id then return jsonb_build_object('error','pair_changed'); end if;
  if p_target->>'kind'='memory' then
    return prepare_memory_photo_v1(p_user_id,(p_target->>'entryId')::uuid,(p_target->>'slot')::integer,
      (p_target->>'expectedPhotoId')::uuid,p_key,p_digest);
  elsif p_target->>'kind' in('frame','doll') then
    return prepare_room_photo_v1(p_user_id,(p_target->>'ownerId')::uuid,p_target->>'kind',p_key,p_digest);
  end if;
  return jsonb_build_object('error','invalid_request');
end $$;
revoke all on function public.prepare_burrow_photo_for_pair_v1(uuid,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_burrow_photo_for_pair_v1(uuid,uuid,jsonb,uuid,text) to service_role;
notify pgrst,'reload schema';
