-- Losing a relationship cancels unfinished adventures; no inventory/coins
-- already granted are removed. Keep rows, dates and receipts as audit history.
create function public.cancel_unpaired_burrow_adventures() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='UPDATE' and old.partner_user_id is not distinct from new.partner_user_id then return new; end if;
  if old.partner_user_id is not null then
    update adventures set status='cancelled',updated_at=now()
    where status in('in_progress','result_ready','interaction_required')
      and ((user_id=old.user_id and partner_id=old.partner_user_id)
        or (user_id=old.partner_user_id and partner_id=old.user_id));
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.cancel_unpaired_burrow_adventures() from public,anon,authenticated;
create trigger burrow_cancel_unpaired_adventures after delete or update of partner_user_id on public.pairings
for each row execute function public.cancel_unpaired_burrow_adventures();

update public.adventures a set status='cancelled',updated_at=now()
where status in('in_progress','result_ready','interaction_required')
  and not exists(select 1 from pairings p join pairings q on q.user_id=p.partner_user_id and q.partner_user_id=p.user_id
    where p.user_id=a.user_id and p.partner_user_id=a.partner_id);

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
 if a.status='cancelled' then return jsonb_build_object('error','adventure_cancelled'); end if;
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
     where ar.item_id=c.stable_id and ar.claim_status='pending' and av.status<>'cancelled' and av.user_id in(p_user_id,partner))
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


create or replace function public.claim_adventure_result_v1(p_user_id uuid,p_adventure_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid;
begin
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
 perform 1 from adventures where id=p_adventure_id and user_id=p_user_id and partner_id=partner for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if exists(select 1 from adventures where id=p_adventure_id and status='cancelled') then return jsonb_build_object('error','adventure_cancelled'); end if;
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

notify pgrst,'reload schema';
