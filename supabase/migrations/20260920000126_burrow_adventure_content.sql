-- Placeholder tuning only. Never enables rollout. Source tags freeze at start;
-- result/item/dialogue snapshots freeze at settlement, not at client render.
create table public.burrow_adventure_rules (
 id boolean primary key default true check(id),
 maximum_price integer not null default 300 check(maximum_price>=0),
 friend_probability numeric not null default .25 check(friend_probability between 0 and 1),
 tag_bonus integer not null default 2 check(tag_bonus between 0 and 10)
);
insert into public.burrow_adventure_rules default values;
create table public.burrow_record_category_tags(category text primary key,tags text[] not null);
insert into public.burrow_record_category_tags values
 ('Food & Drink',array['care','gratitude']),('Exercise & Movement',array['growth','walk']),
 ('Learning & Hobbies',array['reflection','curiosity']),('Travel & Getting Around',array['walk','curiosity']),
 ('Entertainment & Leisure',array['rest','small_win']),('Health & Self-Care',array['care','calm']),
 ('Chores & Home Care',array['care','small_win']),('Nature & Outdoors',array['forest','flower']),
 ('Social & Relationships',array['partner','message']),('Work & Productivity',array['growth','small_win']),
 ('Shopping & Errands',array['walk','small_win']),('Emotions & Feelings',array['gentle','reflection']);
alter table public.burrow_adventure_rules enable row level security;
alter table public.burrow_record_category_tags enable row level security;
revoke all on public.burrow_adventure_rules,public.burrow_record_category_tags from public,anon,authenticated;
grant all on public.burrow_adventure_rules,public.burrow_record_category_tags to service_role;
alter table public.adventures add column source_tags text[] not null default '{}',
 add column rules_snapshot jsonb not null default '{"maximum_price":300,"friend_probability":0.25,"tag_bonus":2}';
create function public.freeze_adventure_source_v1() returns trigger language plpgsql security definer set search_path=public as $$
begin
 select coalesce(array_agg(distinct tag),'{}') into new.source_tags
 from reflect_items r join items i on i.id=r.item_id join burrow_record_category_tags m on m.category=i.category,
 unnest(m.tags) tag where r.reflect_id=new.record_id and r.user_id=new.user_id;
 select to_jsonb(r) into new.rules_snapshot from burrow_adventure_rules r where id;
 return new;
end $$;
create trigger freeze_adventure_source before insert on public.adventures for each row execute function public.freeze_adventure_source_v1();
update public.catalog_items set tags=array_append(tags,'adventure_obtainable') where stable_id like 'adventure_%' and not('adventure_obtainable'=any(tags));
update public.catalog_items set tradable=false,price=null where item_type='souvenir';
insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,price,plus_only,tradable,tags,drop_weight,asset,metadata,is_placeholder)
values('adventure_our_rug_01','burrow-v1-placeholder','our_room','our_room','Trail Together Rug',
 'A shared-room keepsake from the trail. Shared Plus is required to decorate, not to collect.',null,false,true,
 array['adventure_obtainable','partner','care'],6,'{"renderer":"native"}','{"slot":"our_rug"}',true);

-- Reject unusable published content from both encounter pools. Drafts may be
-- incomplete. This also validates content when it is promoted to active.
create function public.valid_burrow_friend_content(p jsonb) returns boolean language plpgsql immutable as $$
declare kind text:=p->>'content_type'; choices jsonb:=p->'choices'; n int;
begin
 if jsonb_typeof(p->'prompt') is distinct from 'string' or coalesce(length(trim(p->>'prompt')),0)=0 or jsonb_typeof(choices) is distinct from 'array'
   or jsonb_typeof(p->'feedback') is distinct from 'object' then return false; end if;
 n:=jsonb_array_length(choices);
 if kind='insight' then return n=0; end if;
 if kind not in('question','emotional_help') or kind is null or n not between 2 and 4 then return false; end if;
 if exists(select 1 from jsonb_array_elements(choices) c where jsonb_typeof(c->'id') is distinct from 'string'
   or jsonb_typeof(c->'label') is distinct from 'string' or coalesce(length(trim(c->>'id')),0)=0 or coalesce(length(trim(c->>'label')),0)=0)
   or (select count(distinct c->>'id') from jsonb_array_elements(choices) c)<>n then return false; end if;
 if kind='question' then return not exists(select 1 from jsonb_array_elements(choices) c
   where jsonb_typeof(p->'feedback'->(c->>'id')) is distinct from 'string'
     or coalesce(length(trim(p->'feedback'->>(c->>'id'))),0)=0); end if;
 return n=2 and choices @> '[{"id":"yes"},{"id":"not_now"}]'::jsonb
   and coalesce(p->>'rage_monster_id','') in('the_swallower','overthinking','procrastination','the_fog','the_spiral','the_hollow','the_comparer','the_wall');
end $$;
alter table public.friend_content add constraint friend_content_publishable check(status<>'active' or public.valid_burrow_friend_content(
 jsonb_build_object('content_type',content_type,'prompt',prompt,'choices',choices,'feedback',feedback,'rage_monster_id',rage_monster_id)));

create or replace function public.settle_adventure_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a adventures%rowtype; r adventure_results%rowtype; partner uuid; item catalog_items%rowtype;
 friend friend_definitions%rowtype; content friend_content%rowtype; kind text; snapshot jsonb;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
 select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if a.partner_id<>partner then return jsonb_build_object('error','not_paired'); end if;
 select * into r from adventure_results where adventure_id=a.id;
 if found then return jsonb_build_object('error',null,'applied',false,'resultId',r.id,'resultType',r.result_type,
   'itemId',r.item_id,'friendId',r.friend_id,'claimStatus',r.claim_status); end if;
 if a.status<>'in_progress' then return jsonb_build_object('error','not_in_progress'); end if;
 if a.ends_at>now() then return jsonb_build_object('error','not_ready','endsAt',a.ends_at); end if;
 if get_byte(decode(md5(a.id::text),'hex'),0)/256.0 < (a.rules_snapshot->>'friend_probability')::numeric then
   select f.* into friend from friend_definitions f where f.status='active' and f.revision_id=a.content_revision
    and not exists(select 1 from user_friend_discoveries d where d.user_id=p_user_id and d.friend_id=f.stable_id)
    and exists(select 1 from friend_content c where c.friend_id=f.stable_id and c.status='active' and c.trigger_scene in('adventure','both'))
    order by md5(a.id::text||':'||f.stable_id) limit 1;
   select c.* into content from friend_content c where c.friend_id=friend.stable_id and c.status='active'
    and c.trigger_scene in('adventure','both') order by md5(a.id::text||':content:'||c.id::text) limit 1;
 end if;
 -- Deterministic exponential-race sampling: real weights, not hash ordering.
 -- Tags increase relative weight, never bypass acquisition/ownership rules.
 select c.* into item from catalog_items c where c.status='active' and c.revision_id=a.content_revision
   and c.item_type in('decor','souvenir','our_room') and c.drop_weight>0 and not c.plus_only
   and 'adventure_obtainable'=any(c.tags) and not(c.tags && array['purchase_only','plus_exclusive','friend_gift'])
   and (c.price is null or c.price<=(a.rules_snapshot->>'maximum_price')::int)
   and not exists(select 1 from gifts g where g.recipient_id=p_user_id and g.item_id=c.stable_id and g.status='pending')
   and not exists(select 1 from adventure_results ar join adventures av on av.id=ar.adventure_id
     where ar.item_id=c.stable_id and ar.claim_status='pending' and av.user_id in(p_user_id,partner))
   and not (exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=c.stable_id) and
     (not c.tradable or c.item_type='souvenir'
      or exists(select 1 from user_inventory i where i.owner_id=partner and i.item_id=c.stable_id)
      or exists(select 1 from gifts g where g.recipient_id=partner and g.item_id=c.stable_id and g.status='pending')))
   order by -ln(((('x'||substr(md5(a.id::text||':'||c.stable_id),1,8))::bit(32)::bigint)+1)/4294967297.0)
     /(c.drop_weight::numeric*(1+(a.rules_snapshot->>'tag_bonus')::int*least(3,
       (select count(distinct tag) from unnest(c.tags) tag where tag=any(a.source_tags))))),c.stable_id limit 1;
 kind:=case when item.stable_id is not null then 'item' when friend.stable_id is not null then 'friend' else 'quiet' end;
 snapshot:=jsonb_build_object('itemSnapshot',case when item.stable_id is not null then to_jsonb(item) end,
   'friendSnapshot',case when friend.stable_id is not null then to_jsonb(friend) end,
   'friendContent',case when content.id is not null then to_jsonb(content) end,'sourceTags',a.source_tags,'rules',a.rules_snapshot);
 insert into adventure_results(adventure_id,result_type,item_id,friend_id,claim_status,metadata)
   values(a.id,kind,item.stable_id,friend.stable_id,'pending',snapshot) returning * into r;
 update adventures set status='result_ready',result_type=kind,result_id=coalesce(item.stable_id,friend.stable_id),updated_at=now() where id=a.id;
 return jsonb_build_object('error',null,'applied',true,'resultId',r.id,'resultType',kind,'itemId',item.stable_id,'friendId',friend.stable_id,'claimStatus','pending');
end $$;

-- Freeze legacy pending questions once during migration, preserving the exact
-- branch the previous app offered. Do not reroll previously selected rewards.
update public.adventure_results r set metadata=r.metadata||jsonb_build_object(
 'itemSnapshot',(select to_jsonb(c) from catalog_items c where c.stable_id=r.item_id),
 'friendSnapshot',(select to_jsonb(f) from friend_definitions f where f.stable_id=r.friend_id),
 'friendContent',(select to_jsonb(c) from friend_content c where c.friend_id=r.friend_id and c.status='active'
   and c.content_type='question' order by c.position,c.id limit 1)) where claim_status<>'claimed';

-- Old pending souvenir duplicates must not become gifts after cutover. Keep
-- any accompanying friend; a depleted item becomes a quiet completed trail.
alter function public.claim_adventure_result_v1(uuid,uuid) rename to claim_adventure_result_core_v1;
create function public.claim_adventure_result_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
 perform 1 from adventures where id=p_adventure_id and user_id=p_user_id and partner_id=partner for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 update adventure_results r set item_id=null,result_type=case when friend_id is null then 'quiet' else 'friend' end,
   metadata=metadata||'{"itemSnapshot":null,"duplicateSkipped":true}'::jsonb
 where r.adventure_id=p_adventure_id and r.claim_status='pending'
   and exists(select 1 from user_inventory i where i.owner_id=p_user_id and i.item_id=r.item_id)
   and (r.metadata->'itemSnapshot'->>'item_type'='souvenir'
     or r.metadata->'itemSnapshot'->'tradable'='false'::jsonb);
 update adventures a set result_type=r.result_type,result_id=coalesce(r.item_id,r.friend_id)
 from adventure_results r where a.id=p_adventure_id and r.adventure_id=a.id;
 return claim_adventure_result_core_v1(p_user_id,p_adventure_id);
end $$;
revoke all on function public.claim_adventure_result_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_adventure_result_v1(uuid,uuid) to service_role;

create or replace function public.complete_friend_interaction_v1(p_user_id uuid,p_adventure_id uuid,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a adventures%rowtype; r adventure_results%rowtype; partner uuid; content jsonb; kind text; choice text;
 feedback text; accepted timestamptz; monster text;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into a from adventures where id=p_adventure_id and user_id=p_user_id for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if a.partner_id<>partner then return jsonb_build_object('error','not_paired'); end if;
 select * into r from adventure_results where adventure_id=a.id and friend_id is not null for update;
 if not found then return jsonb_build_object('error','friend_result_not_found'); end if;
 if a.status='completed' then return jsonb_build_object('error',null,'applied',false,'friendId',r.friend_id,
   'feedback',r.metadata->>'feedback','declined',r.metadata->'declined'); end if;
 if a.status<>'interaction_required' then return jsonb_build_object('error','interaction_not_ready'); end if;
 content:=r.metadata->'friendContent'; kind:=content->>'content_type'; choice:=p_response->>'choiceId';
 if not coalesce(valid_burrow_friend_content(content),false) then return jsonb_build_object('error','content_unavailable'); end if;
 if jsonb_typeof(p_response) is distinct from 'object' then return jsonb_build_object('error','invalid_response'); end if;
 if kind='insight' then
   if p_response->'acknowledged' is distinct from 'true'::jsonb then return jsonb_build_object('error','invalid_response'); end if;
   feedback:='A little thought to carry home.';
 else
   if not exists(select 1 from jsonb_array_elements(content->'choices') c where c->>'id'=choice) then return jsonb_build_object('error','invalid_response'); end if;
   feedback:=content->'feedback'->>choice;
   if kind='emotional_help' then
     if choice='not_now' then feedback:='Another time is okay. Your new friend is still part of your collection.';
     else
       monster:=content->>'rage_monster_id'; accepted:=(r.metadata->>'acceptedAt')::timestamptz;
       if accepted is null then
         update adventure_results set metadata=metadata||jsonb_build_object('acceptedAt',now()) where id=r.id;
         return jsonb_build_object('error',null,'applied',true,'battleRequired',true,'monsterId',monster);
       end if;
       if not exists(select 1 from kit_completions k where k.user_id in(p_user_id,partner) and k.kit='tame_enemy'
         and k.payload->>'monster_id'=monster and k.created_at>=accepted) then return jsonb_build_object('error','battle_required','monsterId',monster); end if;
       feedback:='Thank you for facing that feeling together.';
     end if;
   end if;
 end if;
 update user_friend_discoveries set interaction_completed_at=coalesce(interaction_completed_at,now()) where user_id=p_user_id and friend_id=r.friend_id;
 update adventure_results set claim_status='claimed',claimed_at=now(),metadata=metadata||jsonb_build_object(
   'response',p_response,'feedback',feedback,'declined',kind='emotional_help' and choice='not_now') where id=r.id;
 update adventures set status='completed',updated_at=now() where id=a.id;
 insert into moment_events(pair_low,pair_high,actor_id,event_type,reference_type,reference_id,payload,idempotency_key)
 values(least(p_user_id,partner),greatest(p_user_id,partner),p_user_id,'friend_discovered','adventure',a.id::text,
   jsonb_build_object('friendId',r.friend_id),'friend-discovered:'||a.id::text) on conflict(actor_id,idempotency_key) do nothing;
 return jsonb_build_object('error',null,'applied',true,'friendId',r.friend_id,'feedback',feedback,'declined',kind='emotional_help' and choice='not_now');
end $$;

alter function public.burrow_bootstrap_v1(uuid) rename to burrow_bootstrap_personalization_v1;
create function public.burrow_bootstrap_v1(p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; content jsonb;
begin
 result:=burrow_bootstrap_personalization_v1(p_user_id);
 if result->>'error' is not null then return result; end if;
 content:=result->'adventureResult'->'metadata'->'friendContent';
 return result||jsonb_build_object('friendContent',case when jsonb_typeof(content)='object' then jsonb_build_array(content) else '[]'::jsonb end);
end $$;
revoke all on function public.freeze_adventure_source_v1(),public.valid_burrow_friend_content(jsonb),public.burrow_bootstrap_v1(uuid) from public,anon,authenticated;
grant execute on function public.freeze_adventure_source_v1(),public.valid_burrow_friend_content(jsonb),public.burrow_bootstrap_v1(uuid) to service_role;
notify pgrst,'reload schema';
