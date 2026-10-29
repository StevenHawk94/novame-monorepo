-- Approved: a Plushie's current face belongs to its room owner, not the
-- relationship during upload. Never transfer photos, refund quota, or restore
-- retired bytes. Only current mutual partners may read an owner's doll photos.
begin;

create or replace function public.read_room_photo_v1(p_user_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; photo public.room_photos%rowtype;
begin
 if p_user_id is null then return jsonb_build_object('error','not_found'); end if;
 partner:=lock_burrow_pair(p_user_id);
 select * into photo from room_photos where id=p_photo_id;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if photo.kind='doll' then
  if photo.owner_id<>p_user_id and (partner is null or photo.owner_id<>partner) then
   return jsonb_build_object('error','not_found');
  end if;
 else
  -- Keep the existing frame relationship contract unchanged.
  if partner is null then return jsonb_build_object('error','not_paired'); end if;
  if photo.pair_low<>least(p_user_id,partner) or photo.pair_high<>greatest(p_user_id,partner) then
   return jsonb_build_object('error','not_found');
  end if;
 end if;
 return jsonb_build_object('error',null,'path',photo.private_path);
end $$;

create or replace function public.burrow_bootstrap_v2(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; partner uuid; frames jsonb; dolls jsonb;
begin
 partner:=lock_burrow_pair(p_user_id);
 perform activate_personal_room_v1(p_user_id);
 snapshot:=burrow_bootstrap_v1(p_user_id);
 if snapshot->>'error' is not null then return snapshot; end if;
 -- Preserve existing frame visibility. Doll metadata and the private read
 -- above use the same owner/current-mutual-partner boundary, including solo.
 select coalesce(jsonb_agg(p),'[]'::jsonb) into frames
  from jsonb_array_elements(coalesce(snapshot->'roomPhotos','[]'::jsonb)) p where p->>'kind'<>'doll';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'ownerId',owner_id,'kind',kind,
  'toyId',nullif(toy_id,''),'updatedAt',updated_at)),'[]'::jsonb) into dolls
  from room_photos where kind='doll' and (owner_id=p_user_id or owner_id=partner);
 return snapshot||jsonb_build_object('roomModel','personal-v2','roomPhotos',frames||dolls,
  'loadouts',coalesce((select jsonb_agg(to_jsonb(l)) from room_loadouts l
   where l.room_type='home' and (l.owner_id=p_user_id or l.owner_id=partner)),'[]'::jsonb));
end $$;
revoke all on function public.read_room_photo_v1(uuid,uuid),public.burrow_bootstrap_v2(uuid) from public,anon,authenticated;
grant execute on function public.read_room_photo_v1(uuid,uuid),public.burrow_bootstrap_v2(uuid) to service_role;
commit;
