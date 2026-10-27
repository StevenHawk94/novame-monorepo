-- Additive profile fields and immutable avatar upload lifecycle. Old clients
-- remain supported; no pairing, entitlement or gameplay rules are changed.
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists avatar_upload_version bigint not null default 0;
alter table public.profiles add constraint profile_gender_values check(gender is null or gender in('woman','man','non_binary','prefer_not_to_say'));
create function public.read_account_profile_v1(p_user uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p.id,'display_name',p.display_name,'birthday',p.birthday,'gender',p.gender,
    'has_password',exists(select 1 from auth.users u where u.id=p.id and coalesce(u.encrypted_password,'')<>''))
  from profiles p where p.id=p_user
$$;
revoke all on function public.read_account_profile_v1(uuid) from public,anon,authenticated;
grant execute on function public.read_account_profile_v1(uuid) to service_role;

create table public.profile_avatar_uploads (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null, version bigint not null, path text unique not null,
  created_at timestamptz not null default now(), committed_at timestamptz, superseded boolean not null default false,
  unique(user_id,request_key)
);
create table public.profile_avatar_garbage(path text primary key,not_before timestamptz not null default now()+interval '1 hour',deleted_at timestamptz);
alter table public.profile_avatar_uploads enable row level security;
alter table public.profile_avatar_garbage enable row level security;
revoke all on public.profile_avatar_uploads,public.profile_avatar_garbage from public,anon,authenticated;
grant all on public.profile_avatar_uploads,public.profile_avatar_garbage to service_role;

create function public.profile_avatar_owned_path_v1(p_url text,p_user uuid) returns text
language sql immutable set search_path=public,pg_temp as $$
  select case when split_part(p_url,'/storage/v1/object/public/avatars/',2)
    ~ ('^'||p_user::text||'/([0-9a-fA-F-]+|[0-9]+)\.(jpg|jpeg|png|webp)$')
    then split_part(p_url,'/storage/v1/object/public/avatars/',2) end
$$;

create function public.retire_profile_avatar_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare path text;
begin
  if tg_op='DELETE' or old.avatar_url is distinct from new.avatar_url then
    path:=profile_avatar_owned_path_v1(old.avatar_url,old.id);
    if path is not null then insert into profile_avatar_garbage(path) values(path) on conflict do nothing;end if;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger profile_avatar_retired after update of avatar_url or delete on public.profiles
  for each row execute function public.retire_profile_avatar_v1();

create function public.prepare_profile_avatar_v1(p_user uuid,p_key uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare ticket profile_avatar_uploads%rowtype; revision bigint;
begin
  perform 1 from profiles where id=p_user for update;
  if not found then return jsonb_build_object('error','profile_not_found');end if;
  select * into ticket from profile_avatar_uploads where user_id=p_user and request_key=p_key;
  if found then
    if ticket.committed_at is null and ticket.created_at<now()-interval '24 hours'
      and ticket.version=(select avatar_upload_version from profiles where id=p_user) then
      -- A durable offline job may resume days later. Renew its immutable path
      -- while keeping the same request key; the retired path cannot resurrect.
      insert into profile_avatar_garbage(path) values(ticket.path) on conflict do nothing;
      update profiles set avatar_upload_version=avatar_upload_version+1 where id=p_user returning avatar_upload_version into revision;
      update profile_avatar_uploads set path=p_user::text||'/'||gen_random_uuid()::text||'.jpg',version=revision,created_at=now()
        where id=ticket.id returning * into ticket;
    end if;
    return jsonb_build_object('path',ticket.path,'committed',ticket.committed_at is not null);
  end if;
  update profiles set avatar_upload_version=avatar_upload_version+1 where id=p_user returning avatar_upload_version into revision;
  insert into profile_avatar_uploads(user_id,request_key,version,path)
    values(p_user,p_key,revision,p_user::text||'/'||gen_random_uuid()::text||'.jpg') returning * into ticket;
  return jsonb_build_object('path',ticket.path,'committed',false);
end $$;

create function public.complete_profile_avatar_v1(p_user uuid,p_path text,p_url text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare person profiles%rowtype; ticket profile_avatar_uploads%rowtype;
begin
  select * into person from profiles where id=p_user for update;
  if not found then return jsonb_build_object('error','profile_not_found');end if;
  if profile_avatar_owned_path_v1(p_url,p_user) is distinct from p_path then return jsonb_build_object('error','invalid_path');end if;
  select * into ticket from profile_avatar_uploads where user_id=p_user and path=p_path for update;
  if not found then
    -- Pre-rollout signed tickets and the legacy Base64 endpoint still work,
    -- but a retired path must never resurrect bytes selected for deletion.
    if exists(select 1 from profile_avatar_garbage where path=p_path) then
      return jsonb_build_object('avatarUrl',person.avatar_url,'superseded',true);end if;
  elsif ticket.committed_at is not null then
    return jsonb_build_object('avatarUrl',person.avatar_url,'superseded',ticket.superseded or person.avatar_url is distinct from p_url);
  elsif ticket.created_at<now()-interval '24 hours' or ticket.version<person.avatar_upload_version then
    update profile_avatar_uploads set committed_at=now(),superseded=true where id=ticket.id;
    insert into profile_avatar_garbage(path) values(p_path) on conflict do nothing;
    return jsonb_build_object('avatarUrl',person.avatar_url,'superseded',true);
  end if;
  update profiles set avatar_url=p_url,is_default_avatar=false,updated_at=now() where id=p_user;
  if ticket.id is not null then update profile_avatar_uploads set committed_at=now() where id=ticket.id;end if;
  return jsonb_build_object('avatarUrl',p_url,'superseded',false);
end $$;

create function public.collect_profile_avatar_garbage_v1() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Recover abandoned uploads and old legacy orphan objects, bounded per run.
  insert into profile_avatar_garbage(path)
    select name from storage.objects o where bucket_id='avatars' and created_at<now()-interval '24 hours'
      and name ~ '^[0-9a-f-]{36}/([0-9a-fA-F-]+|[0-9]+)\.(jpg|jpeg|png|webp)$'
      and not exists(select 1 from profiles p where profile_avatar_owned_path_v1(p.avatar_url,p.id)=o.name)
      and not exists(select 1 from profile_avatar_uploads u where u.path=o.name and u.committed_at is null and u.created_at>=now()-interval '24 hours')
      order by created_at limit 100 on conflict do nothing;
  return coalesce((select jsonb_agg(path) from(
    select g.path from profile_avatar_garbage g where not_before<=now() and deleted_at is null
      and not exists(select 1 from profiles p where profile_avatar_owned_path_v1(p.avatar_url,p.id)=g.path)
      and not exists(select 1 from profile_avatar_uploads u where u.path=g.path and u.committed_at is null and u.created_at>=now()-interval '24 hours')
    order by not_before,path limit 100) due),'[]'::jsonb);
end $$;
revoke all on function public.profile_avatar_owned_path_v1(text,uuid),public.retire_profile_avatar_v1(),
  public.prepare_profile_avatar_v1(uuid,uuid),public.complete_profile_avatar_v1(uuid,text,text),public.collect_profile_avatar_garbage_v1() from public,anon,authenticated;
grant execute on function public.profile_avatar_owned_path_v1(text,uuid),public.prepare_profile_avatar_v1(uuid,uuid),
  public.complete_profile_avatar_v1(uuid,text,text),public.collect_profile_avatar_garbage_v1() to service_role;
notify pgrst,'reload schema';
