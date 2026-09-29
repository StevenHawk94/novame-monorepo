-- Memories photos are separate from room frames. Three slots is a replaceable
-- default: the legacy Remember Together code contains no photo implementation.
create table public.memory_entry_photos (
 id uuid primary key,
 entry_id uuid not null references memory_room_entries(id) on delete cascade,
 slot integer not null check(slot between 0 and 2),
 private_path text not null unique,
 updated_at timestamptz not null default now(),
 unique(entry_id,slot)
);
create table public.memory_photo_uploads (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references profiles(id) on delete cascade,
 partner_id uuid not null references profiles(id) on delete cascade,
 entry_id uuid not null references memory_room_entries(id) on delete cascade,
 slot integer not null check(slot between 0 and 2),
 expected_photo_id uuid,
 command_key uuid not null,
 digest text not null,
 private_path text not null unique,
 status text not null default 'pending' check(status in('pending','committed','expired')),
 created_at timestamptz not null default now(),
 unique(actor_id,command_key)
);
-- No profile FK: deletion work must survive account/entry cascades.
create table public.memory_photo_garbage (
 private_path text primary key,
 not_before timestamptz not null default now()+interval '1 hour'
);
create index memory_upload_expiry on memory_photo_uploads(created_at) where status='pending';
create index memory_garbage_due on memory_photo_garbage(not_before);
alter table memory_entry_photos enable row level security;
alter table memory_photo_uploads enable row level security;
alter table memory_photo_garbage enable row level security;
create policy memory_photos_service on memory_entry_photos for all to service_role using(true) with check(true);
create policy memory_uploads_service on memory_photo_uploads for all to service_role using(true) with check(true);
create policy memory_garbage_service on memory_photo_garbage for all to service_role using(true) with check(true);
revoke all on memory_entry_photos,memory_photo_uploads,memory_photo_garbage from anon,authenticated;
grant all on memory_entry_photos,memory_photo_uploads,memory_photo_garbage to service_role;

create function public.retire_memory_photo_path() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into memory_photo_garbage(private_path) values(old.private_path) on conflict do nothing;
 return old;
end $$;
create trigger memory_photo_retire after delete on memory_entry_photos for each row execute function retire_memory_photo_path();
create trigger memory_upload_retire after delete on memory_photo_uploads for each row execute function retire_memory_photo_path();

create function public.retire_memory_entry_photos() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.deleted_at is not null then
   delete from memory_entry_photos where entry_id=new.id;
   with retired as (update memory_photo_uploads set status='expired' where entry_id=new.id and status='pending' returning private_path)
     insert into memory_photo_garbage(private_path) select private_path from retired on conflict do nothing;
   delete from moment_events where reference_type='memory_room_entry' and reference_id=new.id::text;
 end if;
 return new;
end $$;
create trigger memory_entry_photo_retire after update of deleted_at on memory_room_entries
 for each row execute function retire_memory_entry_photos();

create function public.prepare_memory_photo_v1(p_user_id uuid,p_entry_id uuid,p_slot integer,p_expected_id uuid,p_key uuid,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; ticket memory_photo_uploads%rowtype; current_id uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if p_slot is null or p_slot not between 0 and 2 or p_key is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
   then return jsonb_build_object('error','invalid_request'); end if;
 perform 1 from memory_room_entries where id=p_entry_id and author_id=p_user_id and deleted_at is null
   and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 select * into ticket from memory_photo_uploads where actor_id=p_user_id and command_key=p_key;
 if found then
   if ticket.partner_id<>partner or ticket.entry_id<>p_entry_id or ticket.slot<>p_slot or ticket.digest<>p_digest
     or ticket.expected_photo_id is distinct from p_expected_id then return jsonb_build_object('error','idempotency_conflict'); end if;
   if ticket.status='expired' or (ticket.status='pending' and ticket.created_at<now()-interval '24 hours')
     then return jsonb_build_object('error','upload_expired'); end if;
 else
   select id into current_id from memory_entry_photos where entry_id=p_entry_id and slot=p_slot;
   if current_id is distinct from p_expected_id then return jsonb_build_object('error','photo_conflict'); end if;
   ticket.id:=gen_random_uuid();
   insert into memory_photo_uploads(id,actor_id,partner_id,entry_id,slot,expected_photo_id,command_key,digest,private_path)
   values(ticket.id,p_user_id,partner,p_entry_id,p_slot,p_expected_id,p_key,p_digest,p_user_id::text||'/'||ticket.id::text||'.jpg') returning * into ticket;
 end if;
 return jsonb_build_object('error',null,'ticketId',ticket.id,'path',ticket.private_path,'committed',ticket.status='committed');
end $$;

create function public.complete_memory_photo_v1(p_user_id uuid,p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; ticket memory_photo_uploads%rowtype; current_id uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into ticket from memory_photo_uploads where id=p_ticket_id and actor_id=p_user_id and partner_id=partner for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 perform 1 from memory_room_entries where id=ticket.entry_id and author_id=p_user_id and deleted_at is null
   and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if ticket.status='committed' then return jsonb_build_object('error',null,'applied',false); end if;
 if ticket.status='expired' or ticket.created_at<now()-interval '24 hours' then return jsonb_build_object('error','upload_expired'); end if;
 select id into current_id from memory_entry_photos where entry_id=ticket.entry_id and slot=ticket.slot;
 if current_id is distinct from ticket.expected_photo_id then return jsonb_build_object('error','photo_conflict'); end if;
 delete from memory_entry_photos where entry_id=ticket.entry_id and slot=ticket.slot;
 insert into memory_entry_photos(id,entry_id,slot,private_path) values(ticket.id,ticket.entry_id,ticket.slot,ticket.private_path);
 update memory_photo_uploads set status='committed' where id=ticket.id;
 return jsonb_build_object('error',null,'applied',true);
end $$;

create function public.read_memory_photo_v1(p_user_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; path text;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select p.private_path into path from memory_entry_photos p join memory_room_entries e on e.id=p.entry_id
 where p.id=p_photo_id and e.deleted_at is null and e.pair_low=least(p_user_id,partner) and e.pair_high=greatest(p_user_id,partner);
 if path is null then return jsonb_build_object('error','not_found'); end if;
 return jsonb_build_object('error',null,'path',path);
end $$;

create function public.delete_memory_photo_v1(p_user_id uuid,p_entry_id uuid,p_photo_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; removed integer; old_slot integer;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 perform 1 from memory_room_entries where id=p_entry_id and author_id=p_user_id and deleted_at is null
   and pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 select slot into old_slot from memory_entry_photos where id=p_photo_id and entry_id=p_entry_id;
 -- Cancel pending writes for the slot too: an older empty-slot upload must
 -- not resurrect a photo after another device explicitly deletes its successor.
 with retired as (update memory_photo_uploads set status='expired'
   where entry_id=p_entry_id and slot=old_slot and status='pending' returning private_path)
 insert into memory_photo_garbage(private_path) select private_path from retired on conflict do nothing;
 delete from memory_entry_photos where id=p_photo_id and entry_id=p_entry_id;
 get diagnostics removed=row_count;
 return jsonb_build_object('error',null,'applied',removed>0);
end $$;

-- Bounded sweep. Expired tickets can never be committed or reused. Grace period
-- exceeds the upload route's 60s execution budget and signed URL lifetime.
create function public.collect_memory_photo_garbage_v1() returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 with retired as (update memory_photo_uploads set status='expired'
   where id in(select id from memory_photo_uploads where status='pending' and created_at<now()-interval '24 hours' order by created_at limit 100 for update skip locked)
   returning private_path)
 insert into memory_photo_garbage(private_path) select private_path from retired on conflict do nothing;
 return coalesce((select jsonb_agg(private_path) from (select g.private_path from memory_photo_garbage g
   where not_before<=now() and not exists(select 1 from memory_entry_photos p where p.private_path=g.private_path)
   order by not_before limit 100) paths),'[]'::jsonb);
end $$;

alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_character_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 result:=burrow_bootstrap_character_v1(p_user_id);
 if result->>'error' is not null then return result; end if;
 return result||jsonb_build_object('memoryEntries',coalesce((select jsonb_agg(e||jsonb_build_object('photos',
   coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'slot',p.slot,'updatedAt',p.updated_at) order by p.slot)
     from memory_entry_photos p where p.entry_id=(e->>'id')::uuid),'[]'::jsonb)))
   from jsonb_array_elements(result->'memoryEntries') e),'[]'::jsonb));
end $$;
revoke all on function prepare_memory_photo_v1(uuid,uuid,integer,uuid,uuid,text),complete_memory_photo_v1(uuid,uuid),
 read_memory_photo_v1(uuid,uuid),delete_memory_photo_v1(uuid,uuid,uuid),collect_memory_photo_garbage_v1(),
 retire_memory_photo_path(),retire_memory_entry_photos(),burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function prepare_memory_photo_v1(uuid,uuid,integer,uuid,uuid,text),complete_memory_photo_v1(uuid,uuid),
 read_memory_photo_v1(uuid,uuid),delete_memory_photo_v1(uuid,uuid,uuid),collect_memory_photo_garbage_v1(),burrow_bootstrap_v1(uuid) to service_role;
do $$ begin
 if to_regclass('storage.buckets') is not null then
   insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('burrow-memory-photos','burrow-memory-photos',false,1048576,array['image/jpeg'])
   on conflict(id) do update set public=false,file_size_limit=1048576,allowed_mime_types=array['image/jpeg'];
 end if;
end $$;
notify pgrst,'reload schema';
