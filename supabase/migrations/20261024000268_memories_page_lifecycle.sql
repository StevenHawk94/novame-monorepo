-- Explicit completed-page lifecycle. No existing answers/layouts/wallets are deleted.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.couple_journal_pages
  add column protocol integer not null default 1,
  add column completed_at timestamptz,
  add column next_available_at timestamptz,
  add column question_snapshot text;
create table public.couple_journal_books (
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  pair_version text not null,
  active_page_id uuid not null references public.couple_journal_pages(id) on delete cascade,
  primary key(pair_low,pair_high,pair_version)
);
create table public.couple_journal_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_id uuid not null references public.couple_journal_pages(id) on delete cascade,
  opened boolean not null default false,
  answer_at timestamptz,
  primary key(user_id,page_id)
);
create table public.couple_journal_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  request jsonb not null,
  primary key(user_id,request_key)
);
alter table public.couple_journal_books enable row level security;
alter table public.couple_journal_reads enable row level security;
alter table public.couple_journal_receipts enable row level security;
revoke all on public.couple_journal_books,public.couple_journal_reads,public.couple_journal_receipts from public,anon,authenticated;
grant select,insert,update,delete on public.couple_journal_books,public.couple_journal_reads,public.couple_journal_receipts to service_role;

create function public.journal_next_midnight_v2(p_at timestamptz,p_zone text) returns timestamptz
language sql stable set search_path=public as $$
 select (((p_at at time zone p_zone)::date+1)::timestamp at time zone p_zone);
$$;
create or replace function public.couple_journal_page_json_v1(p_page_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',p.id,'date',p.local_date,'pageNumber',p.page_number,
  'questionId',p.question_id,'question',coalesce(p.question_snapshot,q.prompt),
  'private',p.pair_low=p.pair_high,'protocol',p.protocol,'timezone',p.timezone_name,
  'completedAt',p.completed_at,'nextAvailableAt',p.next_available_at,'createdAt',p.created_at,
  'answers',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'authorId',a.author_id,
    'body',a.body,'createdAt',a.created_at,'updatedAt',a.updated_at) order by a.author_id)
    from public.couple_journal_answers a where a.page_id=p.id),'[]'::jsonb))
 from public.couple_journal_pages p join public.couple_journal_questions q on q.id=p.question_id where p.id=p_page_id;
$$;
create function public.journal_complete_page_v2() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update public.couple_journal_pages p set completed_at=now(),
  next_available_at=public.journal_next_midnight_v2(now(),p.timezone_name)
 where p.id=new.page_id and p.protocol=2 and p.completed_at is null and p.pair_low<>p.pair_high
  and exists(select 1 from public.couple_journal_answers a where a.page_id=p.id and a.author_id=p.pair_low)
  and exists(select 1 from public.couple_journal_answers a where a.page_id=p.id and a.author_id=p.pair_high);
 return new;
end $$;
create trigger journal_page_completion_v2 after insert or update on public.couple_journal_answers
 for each row execute function public.journal_complete_page_v2();

-- Once a pair opts into v2, old readers use the same authoritative current page.
alter function public.couple_journal_snapshot_v1(uuid,date) rename to couple_journal_snapshot_legacy268;
create function public.journal_active_page_v2(p_user_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid; hi uuid; ver text; zone text; day date; page public.couple_journal_pages%rowtype;
 n integer; q text; v_prompt text; pos integer;
begin
 partner:=public.lock_burrow_pair(p_user_id);
 if partner is null then return null; end if;
 lo:=least(p_user_id,partner);hi:=greatest(p_user_id,partner);ver:=public.burrow_pair_version_v1(p_user_id,partner);
 if ver is null then raise exception 'pair_changed';end if;
 -- Same lock order as writes, serialization also covers first activation.
 perform pg_advisory_xact_lock(hashtextextended('journal-v2:'||lo||':'||hi||':'||ver,0));
 select p.* into page from public.couple_journal_books b join public.couple_journal_pages p on p.id=b.active_page_id
  where b.pair_low=lo and b.pair_high=hi and b.pair_version=ver for update of p;
 if not found then
  select p.* into page from public.couple_journal_pages p where p.pair_low=lo and p.pair_high=hi and p.pair_version=ver
   order by p.local_date desc,p.created_at desc,p.id desc limit 1 for update;
  if found then
   update public.couple_journal_pages p set protocol=2,question_snapshot=q.prompt,
    completed_at=case when (select count(*) from public.couple_journal_answers a where a.page_id=p.id)=2 then
      (select max(a.updated_at) from public.couple_journal_answers a where a.page_id=p.id) end,
    next_available_at=case when (select count(*) from public.couple_journal_answers a where a.page_id=p.id)=2 then
      public.journal_next_midnight_v2((select max(a.updated_at) from public.couple_journal_answers a where a.page_id=p.id),p.timezone_name) end
   from public.couple_journal_questions q where p.id=page.id and q.id=p.question_id returning p.* into page;
  else
   select coalesce(nullif(timezone_name,''),'UTC') into zone from public.profiles where id=lo;
   day:=(now() at time zone zone)::date;
   select id,prompt into q,v_prompt from public.couple_journal_questions where position=1;
   insert into public.couple_journal_pages(pair_low,pair_high,pair_version,local_date,timezone_name,page_number,question_id,protocol,question_snapshot)
    values(lo,hi,ver,day,zone,1,q,2,v_prompt) returning * into page;
  end if;
  insert into public.couple_journal_books values(lo,hi,ver,page.id);
 end if;
 if page.completed_at is not null and page.next_available_at<=now() then
  -- Freeze each page's zone, including the following boundary; no device-local speculation.
  zone:=page.timezone_name;day:=(now() at time zone zone)::date;
  select 1+(position%50) into pos from public.couple_journal_questions where id=page.question_id;
  select id,prompt into q,v_prompt from public.couple_journal_questions where position=pos;
  select coalesce(max(page_number),0)+1 into n from public.couple_journal_pages where pair_low=lo and pair_high=hi and pair_version=ver;
  insert into public.couple_journal_pages(pair_low,pair_high,pair_version,local_date,timezone_name,page_number,question_id,protocol,question_snapshot)
   values(lo,hi,ver,day,zone,n,q,2,v_prompt) returning * into page;
  update public.couple_journal_books set active_page_id=page.id where pair_low=lo and pair_high=hi and pair_version=ver;
 end if;
 return page.id;
end $$;

create function public.journal_page_for_user_v2(p_user_id uuid,p_page_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select public.couple_journal_page_json_v1(p_page_id)||jsonb_build_object(
  'unread',exists(select 1 from public.couple_journal_answers a left join public.couple_journal_reads r
    on r.user_id=p_user_id and r.page_id=a.page_id
    where a.page_id=p_page_id and a.author_id<>p_user_id and (r.answer_at is null or a.updated_at>r.answer_at)),
  'unopened',not exists(select 1 from public.couple_journal_reads r where r.user_id=p_user_id and r.page_id=p_page_id and r.opened));
$$;
create function public.couple_journal_snapshot_v2(p_user_id uuid,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; lo uuid;hi uuid;ver text;current_id uuid; history jsonb:='[]'; row record;
 count integer:=0;more boolean:=false;cursor uuid;cut public.couple_journal_pages%rowtype;page public.couple_journal_pages%rowtype;
begin
 current_id:=public.journal_active_page_v2(p_user_id);
 if current_id is null then
  if p_before_id is not null then
   select * into cut from public.couple_journal_pages where id=p_before_id and pair_low=p_user_id and pair_high=p_user_id and pair_version='solo';
   if not found then return jsonb_build_object('error','not_found');end if;
  end if;
  history:=public.couple_journal_snapshot_legacy268(p_user_id,cut.local_date);
  if (history->>'nextBefore') is not null then
   select id into cursor from public.couple_journal_pages where pair_low=p_user_id and pair_high=p_user_id and pair_version='solo' and local_date=(history->>'nextBefore')::date;
   history:=jsonb_set(history,'{nextBefore}',to_jsonb(cursor));
  end if;
  return history;
 end if;
 select * into page from public.couple_journal_pages where id=current_id;
 lo:=page.pair_low;hi:=page.pair_high;ver:=page.pair_version;
 if p_before_id is not null then
  select * into cut from public.couple_journal_pages where id=p_before_id and
   ((pair_low=lo and pair_high=hi and pair_version=ver) or (pair_low=p_user_id and pair_high=p_user_id and pair_version='solo'));
  if not found then return jsonb_build_object('error','not_found');end if;
 end if;
 for row in select p.* from public.couple_journal_pages p where
  ((p.pair_low=lo and p.pair_high=hi and p.pair_version=ver) or (p.pair_low=p_user_id and p.pair_high=p_user_id and p.pair_version='solo'))
  and (p.completed_at is not null or (p.protocol=1 and p.id<>current_id and exists(select 1 from public.couple_journal_answers a where a.page_id=p.id)))
  and (p_before_id is null or (p.created_at,p.id)<(cut.created_at,cut.id))
  order by p.created_at desc,p.id desc limit 11
 loop
  count:=count+1;if count<=10 then
   history:=history||jsonb_build_array(public.journal_page_for_user_v2(p_user_id,row.id));cursor:=row.id;
  else more:=true;end if;
 end loop;
 return jsonb_build_object('protocol',2,'today',public.journal_page_for_user_v2(p_user_id,current_id),
  'history',history,'hasMore',more,'nextBefore',case when more then cursor end,
  'todayDate',(now() at time zone page.timezone_name)::date,'timezone',page.timezone_name,'pairVersion',ver);
end $$;
create function public.couple_journal_snapshot_v1(p_user_id uuid,p_before_date date default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid;ver text; result jsonb;rows jsonb;more boolean;last_date date;
begin
 partner:=public.lock_burrow_pair(p_user_id);ver:=public.burrow_pair_version_v1(p_user_id,partner);
 if partner is not null and exists(select 1 from public.couple_journal_books where pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) and pair_version=ver)
  then
   result:=public.couple_journal_snapshot_v2(p_user_id,null);
   select coalesce(jsonb_agg(public.couple_journal_page_json_v1(p.id) order by p.local_date desc),'[]'),count(*)>10 into rows,more
   from (select * from public.couple_journal_pages where
    ((pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) and pair_version=ver) or
     (pair_low=p_user_id and pair_high=p_user_id and pair_version='solo'))
    and local_date<coalesce(p_before_date,(result->>'todayDate')::date)
    and exists(select 1 from public.couple_journal_answers a where a.page_id=couple_journal_pages.id)
    order by local_date desc limit 11) p;
   rows:=(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(rows) with ordinality t(value,n) where n<=10);
   last_date:=(rows->-1->>'date')::date;
   return result||jsonb_build_object('history',rows,'hasMore',more,'nextBefore',case when more then last_date end);
  end if;
 return public.couple_journal_snapshot_legacy268(p_user_id,p_before_date);
end $$;

create function public.save_couple_journal_answer_v2(p_user_id uuid,p_page_id uuid,p_body text,p_expected_updated_at timestamptz,p_key uuid,p_pair_version text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare authorized jsonb;request jsonb;receipt jsonb;result jsonb;partner uuid;
begin
 partner:=public.lock_burrow_pair(p_user_id);
 if coalesce(public.burrow_pair_version_v1(p_user_id,partner),'solo') is distinct from p_pair_version then return jsonb_build_object('error','pair_changed');end if;
 authorized:=public.read_couple_journal_page_v1(p_user_id,p_page_id);
 if authorized?'error' then return authorized;end if;
 request:=jsonb_build_object('page',p_page_id,'body',p_body,'expected',p_expected_updated_at,'pairVersion',p_pair_version);
 select r.request into receipt from public.couple_journal_receipts r where user_id=p_user_id and request_key=p_key;
 if found then
  if receipt<>request then return jsonb_build_object('error','idempotency_conflict');end if;
  return jsonb_build_object('page',public.journal_page_for_user_v2(p_user_id,p_page_id));
 end if;
 result:=public.save_couple_journal_answer_v1(p_user_id,p_page_id,p_body,p_expected_updated_at,p_key);
 if result?'error' then return result;end if;
 insert into public.couple_journal_receipts values(p_user_id,p_key,request);
 return jsonb_build_object('page',public.journal_page_for_user_v2(p_user_id,p_page_id));
end $$;
create function public.read_couple_journal_v2(p_user_id uuid,p_page_id uuid,p_answer_at timestamptz) returns jsonb
language plpgsql security definer set search_path=public as $$
declare authorized jsonb;latest timestamptz;
begin
 authorized:=public.read_couple_journal_page_v1(p_user_id,p_page_id);if authorized?'error' then return authorized;end if;
 select max(updated_at) into latest from public.couple_journal_answers where page_id=p_page_id and author_id<>p_user_id;
 if p_answer_at is not null and (latest is null or p_answer_at>latest) then return jsonb_build_object('error','invalid_request');end if;
 insert into public.couple_journal_reads(user_id,page_id,opened,answer_at) values(p_user_id,p_page_id,true,p_answer_at)
 on conflict(user_id,page_id) do update set opened=true,answer_at=greatest(couple_journal_reads.answer_at,excluded.answer_at);
 return jsonb_build_object('success',true);
end $$;

-- Metadata is bounded, authoritative, and body-free. Client then prepares exact targets.
create function public.couple_journal_attention_v2(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid;ver text;active uuid;items jsonb;
begin
 partner:=public.lock_burrow_pair(p_user_id);if partner is null then return '[]'::jsonb;end if;
 ver:=public.burrow_pair_version_v1(p_user_id,partner);
 if not exists(select 1 from public.couple_journal_books where pair_low=least(p_user_id,partner) and pair_high=greatest(p_user_id,partner) and pair_version=ver) then return null;end if;
 active:=public.journal_active_page_v2(p_user_id);
 select coalesce(jsonb_agg(value),'[]') into items from (
  select jsonb_build_object('id',a.id||':'||a.updated_at,'at',a.updated_at,'pageId',p.id,'answerId',a.id,'revision',a.updated_at,'kind','answer') value
   from public.couple_journal_pages p join public.couple_journal_answers a on a.page_id=p.id
   left join public.couple_journal_reads r on r.user_id=p_user_id and r.page_id=p.id
   where p.pair_low=least(p_user_id,partner) and p.pair_high=greatest(p_user_id,partner) and p.pair_version=ver and a.author_id=partner
    and (r.answer_at is null or a.updated_at>r.answer_at) order by a.updated_at desc limit 200
 ) unread;
 if not exists(select 1 from public.couple_journal_reads where user_id=p_user_id and page_id=active and opened) then
  items:=items||jsonb_build_array(jsonb_build_object('id','page:'||active,'pageId',active,'kind','page','at',
   (select created_at from public.couple_journal_pages where id=active)));
 end if;
 return items;
end $$;
-- Explicit grants only: every entry point derives actor from the API JWT.
do $$ declare fn record;begin
 for fn in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('journal_next_midnight_v2','journal_complete_page_v2','journal_active_page_v2','journal_page_for_user_v2',
  'couple_journal_snapshot_v2','couple_journal_snapshot_v1','couple_journal_snapshot_legacy268','save_couple_journal_answer_v2',
  'read_couple_journal_v2','couple_journal_attention_v2')
 loop execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;
