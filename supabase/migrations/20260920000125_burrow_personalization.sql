-- Replaceable placeholder content; no rollout activation or existing media deletion.
insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,price,tradable,asset,metadata,is_placeholder)
values
 ('placeholder_music_calm','burrow-v1-placeholder','music','music','Quiet Burrow','Temporary original chime loop; replace the bundled track later.',0,false,'{"bundleKey":"calm"}','{"starter":true}',true),
 ('placeholder_music_dream','burrow-v1-placeholder','music','music','Little Daydream','Temporary original chime loop; replace the bundled track later.',80,false,'{"bundleKey":"dream"}','{}',true);
insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,price,plus_only,asset,metadata,is_placeholder)
select 'placeholder_our_'||slot||'_'||v,'burrow-v1-placeholder','our_room','our_room',title||' · '||v,
 'Independent shared-room placeholder. Artwork can be replaced without changing ownership.',
 case when v='01' then 0 else 90 end,true,jsonb_build_object('renderer','native'),
 jsonb_build_object('slot',slot,'starter',v='01'),true
from (values ('our_wall','Cave walls'),('our_light','Pendant light'),('our_rug','Shared rug'),('our_window','Shared window')) x(slot,title)
cross join (values ('01'),('02')) y(v);

create table public.room_photos (
 id uuid primary key default gen_random_uuid(),
 pair_low uuid not null references profiles(id) on delete cascade,
 pair_high uuid not null references profiles(id) on delete cascade,
 owner_id uuid not null references profiles(id) on delete cascade,
 kind text not null check(kind in('frame','doll')),
 private_path text not null,
 updated_by uuid not null references profiles(id) on delete cascade,
 updated_at timestamptz not null default now(),
 check(pair_low<pair_high and owner_id in(pair_low,pair_high)),
 unique(pair_low,pair_high,owner_id,kind)
);
create table public.room_photo_uploads (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references profiles(id) on delete cascade,
 partner_id uuid not null references profiles(id) on delete cascade,
 owner_id uuid not null references profiles(id) on delete cascade,
 kind text not null check(kind in('frame','doll')),
 command_key uuid not null,
 digest text not null,
 private_path text not null,
 created_at timestamptz not null default now(),
 committed_at timestamptz,
 committed_date date,
 unique(actor_id,command_key)
);
-- A second room, a new key, or a parallel request cannot bypass the actor/day cap.
create unique index room_doll_actor_day on public.room_photo_uploads(actor_id,committed_date)
 where kind='doll' and committed_at is not null;
alter table public.room_photos enable row level security;
alter table public.room_photo_uploads enable row level security;
create policy room_photos_read on public.room_photos for select to authenticated
 using(public.can_read_burrow_pair(pair_low,pair_high));
create policy room_photos_service on public.room_photos for all to service_role using(true) with check(true);
create policy room_photo_uploads_service on public.room_photo_uploads for all to service_role using(true) with check(true);
-- Never expose storage paths through PostgREST, even to the other member.
grant select(id,pair_low,pair_high,owner_id,kind,updated_by,updated_at) on public.room_photos to authenticated;
grant all on public.room_photos,public.room_photo_uploads to service_role;

create function public.prepare_room_photo_v1(p_user_id uuid,p_owner_id uuid,p_kind text,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; ticket public.room_photo_uploads%rowtype; today date; tz text; ticket_id uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if p_owner_id is null or p_owner_id not in(p_user_id,partner) or p_kind is null or p_kind not in('frame','doll')
   or (p_kind='frame' and p_owner_id<>p_user_id) or p_key is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
   then return jsonb_build_object('error','invalid_request'); end if;
 select * into ticket from room_photo_uploads where actor_id=p_user_id and command_key=p_key;
 if found then
   if ticket.owner_id<>p_owner_id or ticket.kind<>p_kind or ticket.digest<>p_digest or ticket.partner_id<>partner
     then return jsonb_build_object('error','idempotency_conflict'); end if;
   return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,'committed',ticket.committed_at is not null);
 end if;
 select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where id=p_user_id;
 today:=(now() at time zone tz)::date;
 if p_kind='doll' and exists(select 1 from room_photo_uploads where actor_id=p_user_id and kind='doll' and committed_date=today)
   then return jsonb_build_object('error','daily_limit_reached'); end if;
 ticket_id:=gen_random_uuid();
 insert into room_photo_uploads(id,actor_id,partner_id,owner_id,kind,command_key,digest,private_path)
 values(ticket_id,p_user_id,partner,p_owner_id,p_kind,p_key,p_digest,p_user_id::text||'/'||ticket_id::text||'.jpg') returning * into ticket;
 return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,'committed',false);
end $$;

-- Only the service route calls this AFTER checking the JPEG and uploading it.
create function public.complete_room_photo_v1(p_user_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; ticket public.room_photo_uploads%rowtype; today date; tz text; photo_id uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into ticket from room_photo_uploads where id=p_ticket_id and actor_id=p_user_id and partner_id=partner for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 -- An old successful retry must never restore an old image over a newer image.
 if ticket.committed_at is not null then return jsonb_build_object('error',null,'applied',false); end if;
 select coalesce(nullif(timezone_name,''),'UTC') into tz from profiles where id=p_user_id;
 today:=(now() at time zone tz)::date;
 if ticket.kind='doll' and exists(select 1 from room_photo_uploads where actor_id=p_user_id and kind='doll' and committed_date=today)
   then return jsonb_build_object('error','daily_limit_reached'); end if;
 insert into room_photos(pair_low,pair_high,owner_id,kind,private_path,updated_by)
 values(least(p_user_id,partner),greatest(p_user_id,partner),ticket.owner_id,ticket.kind,ticket.private_path,p_user_id)
 on conflict(pair_low,pair_high,owner_id,kind) do update set private_path=excluded.private_path,updated_by=p_user_id,updated_at=now()
 returning id into photo_id;
 update room_photo_uploads set committed_at=now(),committed_date=today where id=ticket.id;
 insert into moment_events(pair_low,pair_high,actor_id,target_id,event_type,reference_type,reference_id,payload,idempotency_key)
 values(least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,ticket.owner_id,'room_media_updated','room_photo',photo_id::text,
   jsonb_build_object('kind',ticket.kind),'room-photo:'||ticket.id::text);
 return jsonb_build_object('error',null,'applied',true);
end $$;

create function public.read_room_photo_v1(p_user_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; photo public.room_photos%rowtype;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into photo from room_photos where id=p_photo_id and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner);
 if not found then return jsonb_build_object('error','not_found'); end if;
 return jsonb_build_object('error',null,'path',photo.private_path);
end $$;

create function public.select_room_music_v1(p_user_id uuid,p_track_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if lock_burrow_pair(p_user_id) is null then return jsonb_build_object('error','not_paired'); end if;
 if p_track_id is not null and not exists(select 1 from catalog_items c join user_inventory i on i.item_id=c.stable_id
   join content_revisions r on r.id=c.revision_id where i.owner_id=p_user_id and c.stable_id=p_track_id
   and c.item_type='music' and c.status='active' and r.status='published')
   then return jsonb_build_object('error','item_not_owned'); end if;
 insert into room_music(owner_id,track_id) values(p_user_id,p_track_id)
 on conflict(owner_id) do update set track_id=excluded.track_id,updated_at=now();
 return jsonb_build_object('error',null,'applied',true);
end $$;

alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_activity_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; partner uuid;
begin
 result:=burrow_bootstrap_activity_v1(p_user_id);
 if result->>'error' is not null then return result; end if;
 partner:=(result->'partner'->>'id')::uuid;
 return result||jsonb_build_object(
 'musicTrackId',(select track_id from room_music where owner_id=p_user_id),
 'dollChangeUsed',exists(select 1 from room_photo_uploads where actor_id=p_user_id and kind='doll' and committed_date=(result->>'localDate')::date),
 'roomPhotos',coalesce((select jsonb_agg(jsonb_build_object('id',id,'ownerId',owner_id,'kind',kind,'updatedAt',updated_at)) from room_photos
   where pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner)),'[]'::jsonb));
end $$;
revoke all on function public.prepare_room_photo_v1(uuid,uuid,text,uuid,text), public.complete_room_photo_v1(uuid,uuid),
 public.read_room_photo_v1(uuid,uuid),public.select_room_music_v1(uuid,text),public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.prepare_room_photo_v1(uuid,uuid,text,uuid,text), public.complete_room_photo_v1(uuid,uuid),
 public.read_room_photo_v1(uuid,uuid),public.select_room_music_v1(uuid,text),public.burrow_bootstrap_v1(uuid) to service_role;

-- Storage is supplied by Supabase, not by the offline PostgreSQL test fixture.
do $$ begin
 if to_regclass('storage.buckets') is not null then
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('burrow-room-photos','burrow-room-photos',false,1048576,array['image/jpeg'])
   on conflict(id) do update set public=false,file_size_limit=1048576,allowed_mime_types=array['image/jpeg'];
 end if;
end $$;
notify pgrst,'reload schema';
