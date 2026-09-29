-- Admin-only staged edits. Stable IDs, ownership and economic fields are not editable here.
create table public.burrow_content_drafts (
  kind text not null check(kind in('catalog','friends','dialogue','prompts')),
  content_id text not null, base_hash text not null, payload jsonb not null,
  version integer not null default 1, updated_by uuid not null, updated_at timestamptz not null default now(),
  primary key(kind,content_id)
);
create table public.burrow_content_audit (
  id bigint generated always as identity primary key, kind text not null, content_id text not null,
  before_row jsonb not null, after_row jsonb not null, published_by uuid not null,
  published_at timestamptz not null default now()
);
alter table public.burrow_content_drafts enable row level security;
alter table public.burrow_content_audit enable row level security;
revoke all on public.burrow_content_drafts,public.burrow_content_audit from public,anon,authenticated;
grant all on public.burrow_content_drafts,public.burrow_content_audit to service_role;
grant usage,select on sequence public.burrow_content_audit_id_seq to service_role;

create function public.edit_burrow_content_v1(p_admin uuid,p_kind text,p_id text,p_action text,
  p_payload jsonb default null,p_version integer default 0,p_base_hash text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_row jsonb; draft burrow_content_drafts%rowtype; edited jsonb; allowed text[];
begin
  if p_admin is null then return jsonb_build_object('error','invalid_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended('burrow-content:'||p_kind||':'||p_id,0));
  if p_kind='catalog' then
    select to_jsonb(c) into current_row from catalog_items c where stable_id=p_id for update;
    allowed:=array['title','description','asset','is_placeholder'];
  elsif p_kind='friends' then
    select to_jsonb(f) into current_row from friend_definitions f where stable_id=p_id for update;
    allowed:=array['name','subtitle','art','is_placeholder'];
  elsif p_kind='dialogue' then
    select to_jsonb(c) into current_row from friend_content c where id::text=p_id for update;
    allowed:=array['content_type','prompt','choices','feedback','rage_monster_id','trigger_scene','is_placeholder','status'];
  elsif p_kind='prompts' then
    select to_jsonb(p) into current_row from memory_prompts p where stable_id=p_id for update;
    allowed:=array['prompt','is_placeholder','status'];
  else return jsonb_build_object('error','invalid_request'); end if;
  if current_row is null then return jsonb_build_object('error','not_found'); end if;
  select * into draft from burrow_content_drafts where kind=p_kind and content_id=p_id for update;
  if p_action='read' then
    return jsonb_build_object('current',current_row,'baseHash',md5(current_row::text),'draft',to_jsonb(draft),'editable',allowed);
  end if;
  if p_version is distinct from coalesce(draft.version,0) then return jsonb_build_object('error','content_conflict'); end if;
  if p_action='stage' then
    if p_base_hash is distinct from md5(current_row::text) then return jsonb_build_object('error','content_conflict'); end if;
    if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>65536
      then return jsonb_build_object('error','invalid_request'); end if;
    if exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(allowed)))
      then return jsonb_build_object('error','protected_field'); end if;
    insert into burrow_content_drafts(kind,content_id,base_hash,payload,updated_by)
      values(p_kind,p_id,p_base_hash,p_payload,p_admin)
      on conflict(kind,content_id) do update set payload=excluded.payload,base_hash=excluded.base_hash,
        version=burrow_content_drafts.version+1,updated_by=p_admin,updated_at=now()
      returning * into draft;
    return jsonb_build_object('version',draft.version,'staged',true);
  end if;
  if p_action<>'publish' or draft.kind is null then return jsonb_build_object('error','invalid_request'); end if;
  if draft.base_hash<>md5(current_row::text) then return jsonb_build_object('error','content_conflict'); end if;
  edited:=current_row||draft.payload;
  if coalesce(edited->>'title',edited->>'name',edited->>'prompt','') !~ '\S'
    or char_length(coalesce(edited->>'title',edited->>'name',edited->>'prompt',''))>5000
    then return jsonb_build_object('error','invalid_copy'); end if;
  if p_kind='catalog' then
    update catalog_items set title=edited->>'title',description=edited->>'description',asset=edited->'asset',
      is_placeholder=(edited->>'is_placeholder')::boolean,updated_at=now() where stable_id=p_id returning to_jsonb(catalog_items.*) into edited;
  elsif p_kind='friends' then
    update friend_definitions set name=edited->>'name',subtitle=edited->>'subtitle',art=edited->'art',
      is_placeholder=(edited->>'is_placeholder')::boolean,updated_at=now() where stable_id=p_id returning to_jsonb(friend_definitions.*) into edited;
  elsif p_kind='dialogue' then
    -- Existing publish constraint validates all three interaction types and real monster IDs.
    update friend_content set content_type=edited->>'content_type',prompt=edited->>'prompt',choices=edited->'choices',
      feedback=edited->'feedback',rage_monster_id=edited->>'rage_monster_id',trigger_scene=edited->>'trigger_scene',
      is_placeholder=(edited->>'is_placeholder')::boolean,status=edited->>'status'
      where id::text=p_id returning to_jsonb(friend_content.*) into edited;
  else
    update memory_prompts set prompt=edited->>'prompt',is_placeholder=(edited->>'is_placeholder')::boolean,
      status=edited->>'status' where stable_id=p_id returning to_jsonb(memory_prompts.*) into edited;
  end if;
  insert into burrow_content_audit(kind,content_id,before_row,after_row,published_by)
    values(p_kind,p_id,current_row,edited,p_admin);
  -- Retain draft/version after publish so a delayed older admin request cannot
  -- pass an ABA version check. Its next stage must use the newly read base hash.
  update burrow_content_drafts set base_hash=md5(edited::text),version=version+1,updated_by=p_admin,updated_at=now()
    where kind=p_kind and content_id=p_id;
  return jsonb_build_object('published',true,'version',draft.version+1);
end $$;
revoke all on function public.edit_burrow_content_v1(uuid,text,text,text,jsonb,integer,text) from public,anon,authenticated;
grant execute on function public.edit_burrow_content_v1(uuid,text,text,text,jsonb,integer,text) to service_role;
notify pgrst,'reload schema';
