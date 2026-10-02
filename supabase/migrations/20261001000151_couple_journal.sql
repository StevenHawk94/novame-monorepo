-- A shared daily question, with one independently editable answer per person.
-- Generation-scoped pages prevent a reconnect to the same person from exposing
-- answers written during an earlier pairing.
begin;
create table public.couple_journal_questions (
  id text primary key,
  position integer not null unique check (position between 1 and 50),
  prompt text not null check (char_length(prompt) between 10 and 240)
);

insert into public.couple_journal_questions(id,position,prompt) values
('cj_01',1,'What small thing made you feel close to me this week?'),
('cj_02',2,'When did we make each other laugh lately?'),
('cj_03',3,'What everyday ritual feels like ours?'),
('cj_04',4,'What is a moment from our first month together that still makes you smile?'),
('cj_05',5,'Which ordinary day together would you happily live again?'),
('cj_06',6,'What place feels different now because we went there together?'),
('cj_07',7,'What meal or snack has become part of our story?'),
('cj_08',8,'When did you first feel truly comfortable being yourself with me?'),
('cj_09',9,'What tiny kindness from me have you kept in your memory?'),
('cj_10',10,'What song takes you back to a moment we shared?'),
('cj_11',11,'What was our funniest misunderstanding?'),
('cj_12',12,'What did we do together that surprised you in a good way?'),
('cj_13',13,'Which photo of us has a story that the picture cannot tell?'),
('cj_14',14,'What is a quiet moment between us you wish we could bottle?'),
('cj_15',15,'When did we turn a difficult day into a softer one?'),
('cj_16',16,'What little adventure of ours deserves a second chapter?'),
('cj_17',17,'What is something we have learned to do better together?'),
('cj_18',18,'Which shared joke still gets you every time?'),
('cj_19',19,'What detail from a trip or walk together do you remember most clearly?'),
('cj_20',20,'When have you felt especially supported by me?'),
('cj_21',21,'What was the first thing we made or cooked together?'),
('cj_22',22,'What has become more fun because we do it as a pair?'),
('cj_23',23,'Which rainy-day memory of ours would you like to revisit?'),
('cj_24',24,'What is one way our home or favorite spot reflects us?'),
('cj_25',25,'What little habit of mine makes you smile?'),
('cj_26',26,'When did we feel like a team without needing to say it?'),
('cj_27',27,'What was a lovely surprise we stumbled into together?'),
('cj_28',28,'Which celebration of ours felt most like us?'),
('cj_29',29,'What is a memory of us being wonderfully silly?'),
('cj_30',30,'What have we discovered about each other this year?'),
('cj_31',31,'What is one conversation with me you still think about?'),
('cj_32',32,'When did a simple hello or goodbye mean more than usual?'),
('cj_33',33,'What shared tradition would you like us to keep?'),
('cj_34',34,'What did we notice together that other people might have missed?'),
('cj_35',35,'Which small win of ours deserves another celebration?'),
('cj_36',36,'When did you feel proud of how we handled something together?'),
('cj_37',37,'What memory of us outdoors comes to mind first?'),
('cj_38',38,'What is a cozy moment we created out of almost nothing?'),
('cj_39',39,'What new experience felt easier because we tried it together?'),
('cj_40',40,'Which part of our story would you tell a future version of us?'),
('cj_41',41,'What did we laugh about when plans went wrong?'),
('cj_42',42,'What gesture of care between us has become familiar and lovely?'),
('cj_43',43,'What is a moment when we understood each other without many words?'),
('cj_44',44,'Which shared memory has grown sweeter with time?'),
('cj_45',45,'What is a little thing we do that feels uniquely ours?'),
('cj_46',46,'When did we make an unfamiliar place feel welcoming?'),
('cj_47',47,'What is a favorite memory from a morning or late night together?'),
('cj_48',48,'What is something we once worried about that we can smile at now?'),
('cj_49',49,'What moment recently reminded you how far we have come?'),
('cj_50',50,'What memory would you like us to make next?');

create table public.couple_journal_pages (
  id uuid primary key default gen_random_uuid(),
  pair_low uuid not null references public.profiles(id) on delete cascade,
  pair_high uuid not null references public.profiles(id) on delete cascade,
  pair_version text not null,
  local_date date not null,
  timezone_name text not null,
  page_number integer not null check (page_number > 0),
  question_id text not null references public.couple_journal_questions(id),
  created_at timestamptz not null default now(),
  unique(pair_low,pair_high,pair_version,local_date),
  check(pair_low < pair_high)
);
create index couple_journal_pages_history on public.couple_journal_pages
  (pair_low,pair_high,pair_version,local_date desc);

create table public.couple_journal_answers (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.couple_journal_pages(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1500),
  last_request_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(page_id,author_id)
);

alter table public.couple_journal_questions enable row level security;
alter table public.couple_journal_pages enable row level security;
alter table public.couple_journal_answers enable row level security;
revoke all on public.couple_journal_questions,public.couple_journal_pages,public.couple_journal_answers from public,anon,authenticated;
grant select,insert,update on public.couple_journal_questions,public.couple_journal_pages,public.couple_journal_answers to service_role;

create function public.couple_journal_page_json_v1(p_page_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',p.id,'date',p.local_date,'pageNumber',p.page_number,
    'questionId',p.question_id,'question',q.prompt,
    'answers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'authorId',a.author_id,'body',a.body,
        'createdAt',a.created_at,'updatedAt',a.updated_at
      ) order by a.author_id)
      from public.couple_journal_answers a where a.page_id=p.id
    ),'[]'::jsonb)
  )
  from public.couple_journal_pages p
  join public.couple_journal_questions q on q.id=p.question_id
  where p.id=p_page_id;
$$;

create function public.couple_journal_snapshot_v1(p_user_id uuid,p_before_date date default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_partner uuid; v_low uuid; v_high uuid; v_version text;
  v_zone text; v_today date; v_question text; v_page_id uuid;
  v_page_number integer; v_history jsonb:='[]'::jsonb; v_more boolean:=false;
  v_next date; v_row record; v_count integer:=0;
begin
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  v_low:=least(p_user_id,v_partner); v_high:=greatest(p_user_id,v_partner);
  v_version:=public.burrow_pair_version_v1(p_user_id,v_partner);
  if v_version is null then return jsonb_build_object('error','pair_changed'); end if;
  select coalesce(nullif(timezone_name,''),'UTC') into v_zone from public.profiles where id=v_low;
  v_today:=(now() at time zone v_zone)::date;
  select id into v_question from public.couple_journal_questions
    where position=1+(((v_today-date '2026-10-01')%50+50)%50);
  if v_question is null then return jsonb_build_object('error','content_unavailable'); end if;
  select coalesce(max(page_number),0)+1 into v_page_number
    from public.couple_journal_pages
    where pair_low=v_low and pair_high=v_high and pair_version=v_version;
  insert into public.couple_journal_pages(
    pair_low,pair_high,pair_version,local_date,timezone_name,page_number,question_id
  ) values(v_low,v_high,v_version,v_today,v_zone,v_page_number,v_question)
  on conflict(pair_low,pair_high,pair_version,local_date) do nothing;
  select id into v_page_id from public.couple_journal_pages
    where pair_low=v_low and pair_high=v_high and pair_version=v_version and local_date=v_today;

  for v_row in select p.id,p.local_date from public.couple_journal_pages p
    where p.pair_low=v_low and p.pair_high=v_high and p.pair_version=v_version
      and p.local_date<least(v_today,coalesce(p_before_date,v_today))
      and exists(select 1 from public.couple_journal_answers a where a.page_id=p.id)
    order by p.local_date desc limit 11
  loop
    v_count:=v_count+1;
    if v_count<=10 then
      v_history:=v_history||jsonb_build_array(public.couple_journal_page_json_v1(v_row.id));
      v_next:=v_row.local_date;
    else v_more:=true;
    end if;
  end loop;
  return jsonb_build_object(
    'today',public.couple_journal_page_json_v1(v_page_id),
    'history',v_history,'hasMore',v_more,'nextBefore',case when v_more then v_next else null end,
    'todayDate',v_today,'timezone',v_zone,'pairVersion',v_version
  );
end $$;

create function public.save_couple_journal_answer_v1(
  p_user_id uuid,p_page_id uuid,p_body text,p_expected_updated_at timestamptz,p_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_version text; v_page public.couple_journal_pages%rowtype;
  v_answer public.couple_journal_answers%rowtype;
begin
  if p_page_id is null or p_key is null or p_body is null
    or char_length(trim(p_body))<1 or char_length(trim(p_body))>1500
  then return jsonb_build_object('error','invalid_request'); end if;
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then return jsonb_build_object('error','not_paired'); end if;
  v_version:=public.burrow_pair_version_v1(p_user_id,v_partner);
  select * into v_page from public.couple_journal_pages where id=p_page_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_page.pair_low<>least(p_user_id,v_partner) or v_page.pair_high<>greatest(p_user_id,v_partner)
    or v_page.pair_version is distinct from v_version
  then return jsonb_build_object('error','pair_changed'); end if;
  if v_page.local_date>(now() at time zone v_page.timezone_name)::date
  then return jsonb_build_object('error','invalid_request'); end if;
  select * into v_answer from public.couple_journal_answers
    where page_id=p_page_id and author_id=p_user_id for update;
  if found then
    if v_answer.last_request_key=p_key then
      return jsonb_build_object('page',public.couple_journal_page_json_v1(p_page_id)); end if;
    if p_expected_updated_at is distinct from v_answer.updated_at
    then return jsonb_build_object('error','journal_conflict'); end if;
    update public.couple_journal_answers set body=trim(p_body),last_request_key=p_key,
      updated_at=greatest(now(),v_answer.updated_at+interval '1 microsecond')
      where id=v_answer.id;
  else
    if p_expected_updated_at is not null
    then return jsonb_build_object('error','journal_conflict'); end if;
    insert into public.couple_journal_answers(page_id,author_id,body,last_request_key)
      values(p_page_id,p_user_id,trim(p_body),p_key);
  end if;
  return jsonb_build_object('page',public.couple_journal_page_json_v1(p_page_id));
end $$;

revoke all on function public.couple_journal_page_json_v1(uuid),
  public.couple_journal_snapshot_v1(uuid,date),
  public.save_couple_journal_answer_v1(uuid,uuid,text,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.couple_journal_page_json_v1(uuid),
  public.couple_journal_snapshot_v1(uuid,date),
  public.save_couple_journal_answer_v1(uuid,uuid,text,timestamptz,uuid)
  to service_role;
notify pgrst,'reload schema';
commit;
