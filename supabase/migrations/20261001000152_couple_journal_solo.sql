-- A journal is useful before pairing. Solo pages belong only to their author;
-- pairing later never turns those private answers into shared answers.
begin;
alter table public.couple_journal_pages drop constraint couple_journal_pages_check;
alter table public.couple_journal_pages add constraint couple_journal_pages_owner_order
  check (pair_low <= pair_high);

create or replace function public.couple_journal_page_json_v1(p_page_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',p.id,'date',p.local_date,'pageNumber',p.page_number,
    'questionId',p.question_id,'question',q.prompt,
    'private',p.pair_low=p.pair_high,
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

create or replace function public.couple_journal_snapshot_v1(p_user_id uuid,p_before_date date default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_partner uuid; v_low uuid; v_high uuid; v_version text;
  v_zone text; v_today date; v_question text; v_page_id uuid;
  v_page_number integer; v_history jsonb:='[]'::jsonb; v_more boolean:=false;
  v_next date; v_row record; v_count integer:=0;
begin
  v_partner:=public.lock_burrow_pair(p_user_id);
  if v_partner is null then
    v_low:=p_user_id; v_high:=p_user_id; v_version:='solo';
  else
    v_low:=least(p_user_id,v_partner); v_high:=greatest(p_user_id,v_partner);
    v_version:=public.burrow_pair_version_v1(p_user_id,v_partner);
    if v_version is null then return jsonb_build_object('error','pair_changed'); end if;
  end if;
  select coalesce(nullif(timezone_name,''),'UTC') into v_zone from public.profiles
    where id=case when v_partner is null then p_user_id else v_low end;
  if not found then return jsonb_build_object('error','not_found'); end if;
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
    where ((p.pair_low=v_low and p.pair_high=v_high and p.pair_version=v_version)
      or (p.pair_low=p_user_id and p.pair_high=p_user_id and p.pair_version='solo'))
      and p.local_date<least(v_today,coalesce(p_before_date,v_today))
      and exists(select 1 from public.couple_journal_answers a where a.page_id=p.id)
    order by p.local_date desc,p.created_at desc limit 11
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

create or replace function public.save_couple_journal_answer_v1(
  p_user_id uuid,p_page_id uuid,p_body text,p_expected_updated_at timestamptz,p_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_partner uuid; v_version text; v_page public.couple_journal_pages%rowtype;
  v_answer public.couple_journal_answers%rowtype;
begin
  if p_page_id is null or p_key is null or p_body is null
    or char_length(trim(p_body))<1 or char_length(trim(p_body))>1500
  then return jsonb_build_object('error','invalid_request'); end if;
  v_partner:=public.lock_burrow_pair(p_user_id);
  select * into v_page from public.couple_journal_pages where id=p_page_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_page.pair_low=p_user_id and v_page.pair_high=p_user_id
    and v_page.pair_version='solo' then
    -- The writer may still edit a private page after connecting to a partner.
    null;
  else
    if v_partner is null then return jsonb_build_object('error','pair_changed'); end if;
    v_version:=public.burrow_pair_version_v1(p_user_id,v_partner);
    if v_page.pair_low<>least(p_user_id,v_partner)
      or v_page.pair_high<>greatest(p_user_id,v_partner)
      or v_page.pair_version is distinct from v_version
    then return jsonb_build_object('error','pair_changed'); end if;
  end if;
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

notify pgrst,'reload schema';
commit;
