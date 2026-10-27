begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Existing objects are preserved. Only server-issued exact-path tickets may
-- create avatars; a public download bucket is not a public write bucket.
drop policy if exists "Users can upload avatars" on storage.objects;
update storage.buckets set file_size_limit=1048576,
 allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='avatars';

create function public.security_session_active_v1(p_user uuid,p_session uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now())
   and (u.banned_until is null or u.banned_until<=now()));
$$;

create table public.security_delete_challenges(
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '10 minutes',
 attempts integer not null default 0 check(attempts between 0 and 5),authorized_at timestamptz,
 proof_hash text check(proof_hash is null or proof_hash~'^[a-f0-9]{64}$')
);
alter table public.security_delete_challenges enable row level security;
revoke all on public.security_delete_challenges from public,anon,authenticated;
grant all on public.security_delete_challenges to service_role;

create function public.security_delete_challenge_v1(p_user uuid,p_session uuid,p_id uuid,p_action text,p_proof text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.security_delete_challenges%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not public.security_session_active_v1(p_user,p_session) then return jsonb_build_object('error','session_revoked');end if;
 if p_action='create' then
  delete from public.security_delete_challenges where user_id=p_user and (session_id=p_session or expires_at<now());
  if p_proof is not null and p_proof!~'^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid_request');end if;
  insert into public.security_delete_challenges(id,user_id,session_id,proof_hash) values(p_id,p_user,p_session,p_proof);
  return jsonb_build_object('success',true);
 end if;
 select * into c from public.security_delete_challenges where id=p_id and user_id=p_user and session_id=p_session for update;
 if not found or c.expires_at<=now() then return jsonb_build_object('error','confirmation_expired');end if;
 if p_action='status' then return jsonb_build_object('authorized',c.authorized_at is not null);end if;
 if p_action='verify' then
  if c.attempts>=5 then return jsonb_build_object('error','too_many_attempts');end if;
  update public.security_delete_challenges set attempts=attempts+1 where id=c.id;
  if c.proof_hash is null or p_proof is distinct from c.proof_hash then return jsonb_build_object('error','invalid_confirmation');end if;
  update public.security_delete_challenges set authorized_at=now() where id=c.id;
 elsif p_action='authorize_guest' and exists(select 1 from auth.users where id=p_user and is_anonymous) then
  update public.security_delete_challenges set authorized_at=now() where id=c.id;
 else return jsonb_build_object('error','invalid_action');end if;
 return jsonb_build_object('success',true);
end $$;
revoke all on function public.security_session_active_v1(uuid,uuid),
 public.security_delete_challenge_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.security_session_active_v1(uuid,uuid),
 public.security_delete_challenge_v1(uuid,uuid,uuid,text,text) to service_role;

-- Grant and Google consumption intent commit together. Raw purchase tokens
-- never leave the service role; successful acknowledgement erases the token.
create table public.store_finish_jobs(
 key text primary key,user_id uuid references public.profiles(id) on delete set null,
 product_id text not null,purchase_token text,attempts integer not null default 0,
 next_attempt timestamptz not null default now(),lease_id uuid,lease_until timestamptz,
 finished_at timestamptz,created_at timestamptz not null default now()
);
alter table public.store_finish_jobs enable row level security;
revoke all on public.store_finish_jobs from public,anon,authenticated;
grant all on public.store_finish_jobs to service_role;
create function public.credit_google_coin_v3(p_args jsonb,p_token text,p_consume boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_args->>'p_store' is distinct from 'google' or p_token is null or p_consume is null or length(p_token) not between 1 and 12000
  or encode(sha256(convert_to(p_token,'UTF8')),'hex') is distinct from p_args->>'p_credential'
  then return jsonb_build_object('error','invalid_request');end if;
 result:=public.apply_burrow_coin_purchase_v2((p_args->>'p_user_id')::uuid,'google',p_args->>'p_environment',p_args->>'p_credential',
  p_args->>'p_product_id',(p_args->>'p_quantity')::integer,(p_args->>'p_refunded')::integer,
  (p_args->>'p_signed_at')::timestamptz,(p_args->>'p_allow_sandbox_room')::boolean);
 if result->>'error' is not null then return result;end if;
 if p_consume then
  insert into public.store_finish_jobs(key,user_id,product_id,purchase_token)
   values(p_args->>'p_credential',(p_args->>'p_user_id')::uuid,p_args->>'p_product_id',p_token)
   on conflict(key) do nothing;
 end if;
 return result;
end $$;
create function public.claim_store_finish_jobs_v1(p_limit integer default 10)
returns setof public.store_finish_jobs language sql security definer set search_path=public,pg_temp as $$
 update public.store_finish_jobs j set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 where key in(select key from public.store_finish_jobs where finished_at is null and next_attempt<=now()
  and (lease_until is null or lease_until<now()) order by next_attempt limit least(greatest(p_limit,1),10) for update skip locked)
 returning j.*;
$$;
create function public.complete_store_finish_job_v1(p_key text,p_lease uuid,p_success boolean)
returns void language sql security definer set search_path=public,pg_temp as $$
 update public.store_finish_jobs set attempts=attempts+1,lease_id=null,lease_until=null,
  finished_at=case when p_success then now() else null end,
  purchase_token=case when p_success then null else purchase_token end,
  next_attempt=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer))
 where key=p_key and lease_id=p_lease;
$$;
revoke all on function public.credit_google_coin_v3(jsonb,text,boolean),public.claim_store_finish_jobs_v1(integer),
 public.complete_store_finish_job_v1(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.credit_google_coin_v3(jsonb,text,boolean),public.claim_store_finish_jobs_v1(integer),
 public.complete_store_finish_job_v1(text,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
