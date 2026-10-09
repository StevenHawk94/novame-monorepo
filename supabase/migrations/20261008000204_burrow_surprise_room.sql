-- Private, immutable photo + voice messages. Only the send transaction charges.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('burrow-surprises','burrow-surprises',false,1572864,array['image/jpeg','audio/mp4'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.burrow_surprises(
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references profiles(id) on delete cascade,
 recipient_id uuid not null references profiles(id) on delete cascade,
 pair_version text not null, frame text not null check(frame in('santa','bunny','flower','heart','birthday','star')),
 duration_ms integer not null check(duration_ms between 1000 and 60000),
 digest text not null check(length(digest)=64), idempotency_key uuid not null,
 photo_path text not null, audio_path text not null,
 created_at timestamptz not null default now(), sent_at timestamptz, opened_at timestamptz, expired_at timestamptz,
 check(sender_id<>recipient_id),unique(sender_id,idempotency_key)
);
create index burrow_surprise_inbox on public.burrow_surprises(recipient_id,sent_at desc) where sent_at is not null;
alter table public.burrow_surprises enable row level security;
revoke all on public.burrow_surprises from public,anon,authenticated;
grant all on public.burrow_surprises to service_role;

create function public.prepare_burrow_surprise_v1(p_user uuid,p_partner uuid,p_version text,p_key uuid,p_frame text,p_duration integer,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item burrow_surprises%rowtype; prefix text;
begin
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if partner is distinct from p_partner or p_version is distinct from burrow_pair_version_v1(p_user,partner) or p_version is null
 then return jsonb_build_object('error','pair_changed'); end if;
 if p_key is null or p_frame is null or p_frame not in('santa','bunny','flower','heart','birthday','star')
 or p_duration is null or p_duration not between 1000 and 60000 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
 then return jsonb_build_object('error','invalid_request'); end if;
 select * into item from burrow_surprises where sender_id=p_user and idempotency_key=p_key for update;
 if found then
  if item.expired_at is not null then return jsonb_build_object('error','draft_expired'); end if;
  if item.digest<>p_digest or item.pair_version<>p_version or item.recipient_id<>p_partner or item.frame<>p_frame or item.duration_ms<>p_duration
  then return jsonb_build_object('error','idempotency_conflict'); end if;
 else
  if coalesce((select carrot_balance from wallets where user_id=p_user),0)<300 then return jsonb_build_object('error','insufficient_balance'); end if;
  prefix:=p_user::text||'/'||p_key::text;
  insert into burrow_surprises(sender_id,recipient_id,pair_version,frame,duration_ms,digest,idempotency_key,photo_path,audio_path)
  values(p_user,p_partner,p_version,p_frame,p_duration,p_digest,p_key,prefix||'/face.jpg',prefix||'/voice.m4a') returning * into item;
 end if;
 return jsonb_build_object('id',item.id,'photoPath',item.photo_path,'audioPath',item.audio_path,'committed',item.sent_at is not null);
end $$;

create function public.complete_burrow_surprise_v1(p_user uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item burrow_surprises%rowtype; receipt jsonb;
begin
 partner:=lock_burrow_pair(p_user);
 select * into item from burrow_surprises where id=p_id and sender_id=p_user for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if item.expired_at is not null then return jsonb_build_object('error','draft_expired'); end if;
 if partner is null or item.recipient_id<>partner or item.pair_version is distinct from burrow_pair_version_v1(p_user,partner)
 then return jsonb_build_object('error','pair_changed'); end if;
 if item.sent_at is not null then return jsonb_build_object('id',item.id,'applied',false); end if;
 if not exists(select 1 from storage.objects where bucket_id='burrow-surprises' and name=item.photo_path)
 or not exists(select 1 from storage.objects where bucket_id='burrow-surprises' and name=item.audio_path)
 then return jsonb_build_object('error','media_incomplete'); end if;
 receipt:=change_carrot_balance_v1(p_user,-300,'surprise_sent','surprise',item.id::text,'surprise:'||item.id::text);
 if receipt->>'error' is not null then return receipt; end if;
 update burrow_surprises set sent_at=now() where id=item.id;
 return jsonb_build_object('id',item.id,'applied',true,'spent',300);
end $$;
-- Expire abandoned uploads under the same row lock as commit. Keep tombstones
-- so a late retry cannot resurrect a deleted upload and then charge for it.
create function public.collect_surprise_garbage_v1()
returns jsonb language plpgsql security definer set search_path=public as $$
declare paths jsonb;
begin
 with abandoned as (select id from burrow_surprises where sent_at is null and expired_at is null
   and created_at<now()-interval '7 days' order by created_at for update skip locked limit 100)
 update burrow_surprises set expired_at=now() where id in(select id from abandoned);
 select coalesce(jsonb_agg(name),'[]'::jsonb) into paths from (
  select o.name from storage.objects o left join burrow_surprises s on o.name in(s.photo_path,s.audio_path)
  where o.bucket_id='burrow-surprises' and o.created_at<now()-interval '1 day'
   and (s.id is null or s.expired_at is not null) order by o.created_at limit 100
 ) garbage;
 return paths;
end $$;
revoke all on function public.collect_surprise_garbage_v1() from public,anon,authenticated;
grant execute on function public.collect_surprise_garbage_v1() to service_role;

-- Read authorization is rechecked even for replay and signed-link renewal.
create function public.read_burrow_surprises_v1(p_user uuid,p_id uuid default null,p_open boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; version text; item burrow_surprises%rowtype; items jsonb;
begin
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('items','[]'::jsonb); end if;
 version:=burrow_pair_version_v1(p_user,partner);
 if p_id is not null then
  select * into item from burrow_surprises where id=p_id and sent_at is not null and pair_version=version
   and ((sender_id=p_user and recipient_id=partner) or (recipient_id=p_user and sender_id=partner)) for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if p_open and item.recipient_id=p_user then update burrow_surprises set opened_at=coalesce(opened_at,now()) where id=p_id; end if;
  return jsonb_build_object('photoPath',item.photo_path,'audioPath',item.audio_path);
 end if;
 select coalesce(jsonb_agg(to_jsonb(s)-'digest'-'idempotency_key'-'photo_path'-'audio_path'-'pair_version'), '[]'::jsonb) into items
 from (select * from burrow_surprises where sent_at is not null and pair_version=version
 and ((sender_id=p_user and recipient_id=partner) or (recipient_id=p_user and sender_id=partner)) order by sent_at desc limit 100) s;
 return jsonb_build_object('items',items);
end $$;
revoke all on function public.prepare_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text),
 public.complete_burrow_surprise_v1(uuid,uuid),public.read_burrow_surprises_v1(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.prepare_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text),
 public.complete_burrow_surprise_v1(uuid,uuid),public.read_burrow_surprises_v1(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
