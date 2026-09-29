-- Additive lifecycle protection. Never delete Storage objects inside SQL.
alter table public.room_photo_uploads add column expired_at timestamptz;
create index room_photo_upload_expiry on public.room_photo_uploads(created_at)
 where committed_at is null and expired_at is null;
-- Deliberately no profile FK: account deletion must not erase cleanup work.
create table public.room_photo_garbage (
 private_path text primary key,
 not_before timestamptz not null default now()+interval '1 hour'
);
create index room_photo_garbage_due on public.room_photo_garbage(not_before);
alter table public.room_photo_garbage enable row level security;
create policy room_photo_garbage_service on public.room_photo_garbage for all to service_role using(true) with check(true);
revoke all on public.room_photo_garbage from public,anon,authenticated;
grant all on public.room_photo_garbage to service_role;

create function public.retire_room_photo_path() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' or old.private_path is distinct from new.private_path then
   insert into room_photo_garbage(private_path) values(old.private_path) on conflict do nothing;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger room_photo_path_retired after update of private_path or delete on public.room_photos
 for each row execute function public.retire_room_photo_path();
create trigger room_photo_ticket_retired after delete on public.room_photo_uploads
 for each row execute function public.retire_room_photo_path();

-- Keep committed receipts (including the daily doll allowance); their obsolete
-- objects can be removed without deleting idempotency/accounting records.
insert into room_photo_garbage(private_path)
 select u.private_path from room_photo_uploads u where u.committed_at is not null
 and not exists(select 1 from room_photos p where p.private_path=u.private_path)
 on conflict do nothing;

alter function public.prepare_room_photo_v1(uuid,uuid,text,uuid,text) rename to prepare_room_photo_before_expiry_v1;
alter function public.complete_room_photo_v1(uuid,uuid) rename to complete_room_photo_before_expiry_v1;
revoke all on function public.prepare_room_photo_before_expiry_v1(uuid,uuid,text,uuid,text),
 public.complete_room_photo_before_expiry_v1(uuid,uuid) from public,anon,authenticated,service_role;

create function public.prepare_room_photo_v1(p_user_id uuid,p_owner_id uuid,p_kind text,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; ticket room_photo_uploads%rowtype;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into ticket from room_photo_uploads where actor_id=p_user_id and command_key=p_key for update;
 if found then
   if ticket.partner_id<>partner or ticket.owner_id is distinct from p_owner_id or ticket.kind is distinct from p_kind
     or ticket.digest is distinct from p_digest then return jsonb_build_object('error','idempotency_conflict'); end if;
   if ticket.expired_at is not null or (ticket.committed_at is null and ticket.created_at<now()-interval '24 hours')
     then return jsonb_build_object('error','upload_expired'); end if;
 end if;
 return prepare_room_photo_before_expiry_v1(p_user_id,p_owner_id,p_kind,p_key,p_digest);
end $$;

create function public.complete_room_photo_v1(p_user_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; ticket room_photo_uploads%rowtype;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into ticket from room_photo_uploads where id=p_ticket_id and actor_id=p_user_id and partner_id=partner for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if ticket.expired_at is not null or (ticket.committed_at is null and ticket.created_at<now()-interval '24 hours')
   then return jsonb_build_object('error','upload_expired'); end if;
 return complete_room_photo_before_expiry_v1(p_user_id,p_ticket_id);
end $$;

-- Bounded sweep locks pending tickets before expiring them. Completion takes
-- the same ticket lock, so cleanup cannot race a still-valid attachment.
create function public.collect_room_photo_garbage_v1() returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 with retired as (
   update room_photo_uploads set expired_at=now() where id in(
     select id from room_photo_uploads where committed_at is null and expired_at is null
       and created_at<now()-interval '24 hours' order by created_at limit 100 for update skip locked
   ) returning private_path
 ) insert into room_photo_garbage(private_path) select private_path from retired on conflict do nothing;
 return coalesce((select jsonb_agg(private_path) from (
   select g.private_path from room_photo_garbage g where not_before<=now()
     and not exists(select 1 from room_photos p where p.private_path=g.private_path)
     and not exists(select 1 from room_photo_uploads u where u.private_path=g.private_path and u.committed_at is null and u.expired_at is null)
   order by not_before,private_path limit 100
 ) due),'[]'::jsonb);
end $$;
revoke all on function public.retire_room_photo_path(),public.prepare_room_photo_v1(uuid,uuid,text,uuid,text),
 public.complete_room_photo_v1(uuid,uuid),public.collect_room_photo_garbage_v1() from public,anon,authenticated;
grant execute on function public.prepare_room_photo_v1(uuid,uuid,text,uuid,text),
 public.complete_room_photo_v1(uuid,uuid),public.collect_room_photo_garbage_v1() to service_role;
notify pgrst,'reload schema';
