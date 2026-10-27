-- Catalogue settings are authoritative for both old and new clients.
begin;
create function public.burrow_has_plus_v1(p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p where coalesce(p.subscription_tier::text,'free')<>'free'
  and (p.id=p_user or exists(select 1 from pairings a join pairings b
    on b.user_id=a.partner_user_id and b.partner_user_id=a.user_id
    where a.user_id=p_user and a.partner_user_id=p.id)));
$$;
create function public.burrow_service_offer_v1(p_user uuid,p_id text,p_kind text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare item catalog_items%rowtype;
begin
 select c.* into item from catalog_items c join content_revisions r on r.id=c.revision_id
 where c.stable_id=p_id and c.item_type=p_kind and c.status='active' and r.status='published'
  and c.revision_id=(select value from app_config where key='app_major_update_content_revision');
 if not found or item.price is null or item.price not between 1 and 99999 then return jsonb_build_object('error','not_for_sale'); end if;
 if item.plus_only and not burrow_has_plus_v1(p_user) then return jsonb_build_object('error','plus_required'); end if;
 return jsonb_build_object('price',item.price,'version',item.shop_price_version,'plus_only',item.plus_only);
end $$;
-- Fail closed on an unexpected previous function definition rather than publish
-- a partially upgraded price editor. This preserves the existing CAS/audit RPC.
do $$ declare original text; revised text; begin
 original:=pg_get_functiondef('public.set_burrow_shop_prices_v1(uuid,text,jsonb,text)'::regprocedure);
 revised:=replace(replace(original,'''ladders'',''dresser_plants'')','''ladders'',''dresser_plants'',''games'',''surprises'')'),
   'row.item_type not in(''decor'',''outfit'')','row.item_type not in(''decor'',''outfit'',''game'',''surprise'')');
 if revised=original or position('''games'',''surprises''' in revised)=0 or position('''game'',''surprise''' in revised)=0
 then raise exception 'Unexpected Shop settings definition'; end if;
 if position('if row.shop_price_version<>' in revised)=0 then raise exception 'Missing settings CAS boundary'; end if;
 revised:=replace(revised,'if row.shop_price_version<>',
  'if row.item_type in(''game'',''surprise'') and row.requested ? ''price'' and (row.requested->>''price'')::integer>99999 then return jsonb_build_object(''error'',''price_out_of_range'',''itemId'',row.stable_id); end if; if row.shop_price_version<>');
 execute revised;
end $$;
-- Service products must never pass through Shop inventory checkout. That
-- would charge coins without creating a game unlock or delivering a Surprise.
do $$ declare signature text; original text; revised text; variable text; begin
 foreach signature in array array['public.purchase_catalog_item_v1(uuid,uuid,text,text)','public.solo_burrow_purchase_v1(uuid,text,text)'] loop
  if to_regprocedure(signature) is null then continue; end if;
  original:=pg_get_functiondef(signature::regprocedure);
  variable:=case when signature like '%purchase_catalog_item%' then 'v_item' else 'item' end;
  revised:=replace(original,'if not found or '||variable||'.price is null',
    'if not found or '||variable||'.item_type in(''game'',''surprise'') or '||variable||'.price is null');
  if revised=original then raise exception 'Unexpected inventory checkout definition: %',signature; end if;
  execute revised;
 end loop;
end $$;
alter table public.burrow_game_unlocks drop constraint burrow_game_unlocks_price_paid_check;
alter table public.burrow_game_unlocks add constraint burrow_game_unlocks_price_paid_check check(price_paid between 1 and 1000000);
alter table public.burrow_game_unlocks alter column price_paid set default 150;
create table public.burrow_game_purchase_receipts(
 actor_id uuid not null references profiles(id) on delete cascade,key uuid not null,game_id text not null,
 price integer not null,primary key(actor_id,key));
alter table public.burrow_game_purchase_receipts enable row level security;
revoke all on public.burrow_game_purchase_receipts from public,anon,authenticated;
grant all on public.burrow_game_purchase_receipts to service_role;
create function public.burrow_game_unlock_v2(p_user_id uuid,p_game_id text,p_key uuid,p_expected_price integer default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare partner uuid; offer jsonb; payment jsonb; prior burrow_game_purchase_receipts%rowtype;
begin
 if p_key is null or p_game_id is null then return jsonb_build_object('error','invalid_request'); end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 partner:=lock_burrow_pair(p_user_id);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 select * into prior from burrow_game_purchase_receipts where actor_id=p_user_id and key=p_key;
 if found and prior.game_id<>p_game_id then return jsonb_build_object('error','idempotency_conflict'); end if;
 if exists(select 1 from burrow_game_unlocks where game_id=p_game_id and owner_id in(p_user_id,partner)) then
  return jsonb_build_object('error',null,'unlocked',true,'charged',false); end if;
 offer:=burrow_service_offer_v1(p_user_id,'game:'||p_game_id,'game');
 if offer->>'error' is not null then return offer; end if;
 if p_expected_price is null and ((offer->>'price')::integer<>150 or (offer->>'version')::bigint<>0)
  then return jsonb_build_object('error','price_confirmation_required'); end if;
 if p_expected_price is not null and p_expected_price<>(offer->>'price')::integer
  then return jsonb_build_object('error','price_changed','price',offer->'price'); end if;
 payment:=change_carrot_balance_v1(p_user_id,-(offer->>'price')::integer,'game_unlock','game',p_game_id,'game-unlock:'||p_key::text);
 if payment->>'error' is not null then return payment; end if;
 insert into burrow_game_unlocks(owner_id,game_id,price_paid) values(p_user_id,p_game_id,(offer->>'price')::integer);
 insert into burrow_game_purchase_receipts values(p_user_id,p_key,p_game_id,(offer->>'price')::integer);
 return payment||jsonb_build_object('error',null,'unlocked',true,'charged',coalesce((payment->>'applied')::boolean,false));
end $$;
create or replace function public.burrow_game_unlock_v1(p_user_id uuid,p_game_id text,p_key uuid) returns jsonb
language sql security definer set search_path=public as $$ select burrow_game_unlock_v2(p_user_id,p_game_id,p_key,null); $$;
-- Gate new rounds, but never prevent viewing or completing existing rounds.
alter function public.burrow_game_start_v1(uuid,text,jsonb) rename to burrow_game_start_before_catalog_v1;
create function public.burrow_game_start_v1(p_user_id uuid,p_game_id text,p_questions jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare offer jsonb; begin
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 perform lock_burrow_pair(p_user_id);
 offer:=burrow_service_offer_v1(p_user_id,'game:'||p_game_id,'game');
 if offer->>'error' is not null then return offer; end if;
 return burrow_game_start_before_catalog_v1(p_user_id,p_game_id,p_questions);
end $$;
alter table public.burrow_surprises add column price_paid integer not null default 300 check(price_paid between 1 and 1000000);
create function public.prepare_burrow_surprise_v2(p_user uuid,p_partner uuid,p_version text,p_key uuid,p_frame text,p_duration integer,p_digest text,p_expected_price integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item burrow_surprises%rowtype; prefix text; offer jsonb;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if partner is distinct from p_partner or p_version is distinct from burrow_pair_version_v1(p_user,partner) or p_version is null
 then return jsonb_build_object('error','pair_changed'); end if;
 if p_key is null or p_frame is null or p_duration is null or p_duration not between 1000 and 60000
  or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid_request'); end if;
 select * into item from burrow_surprises where sender_id=p_user and idempotency_key=p_key for update;
 if found then
  if item.expired_at is not null then return jsonb_build_object('error','draft_expired'); end if;
  if item.digest<>p_digest or item.pair_version<>p_version or item.recipient_id<>p_partner or item.frame<>p_frame or item.duration_ms<>p_duration
  then return jsonb_build_object('error','idempotency_conflict'); end if;
 else
  offer:=burrow_service_offer_v1(p_user,'surprise:'||p_frame,'surprise');
  if offer->>'error' is not null then return offer; end if;
  if p_expected_price is null and ((offer->>'price')::integer<>300 or (offer->>'version')::bigint<>0)
   then return jsonb_build_object('error','price_confirmation_required'); end if;
  if p_expected_price is not null and p_expected_price<>(offer->>'price')::integer
   then return jsonb_build_object('error','price_changed','price',offer->'price'); end if;
  if coalesce((select carrot_balance from wallets where user_id=p_user),0)<(offer->>'price')::integer
   then return jsonb_build_object('error','insufficient_balance'); end if;
  prefix:=p_user::text||'/'||p_key::text;
  insert into burrow_surprises(sender_id,recipient_id,pair_version,frame,duration_ms,digest,idempotency_key,photo_path,audio_path,price_paid)
   values(p_user,p_partner,p_version,p_frame,p_duration,p_digest,p_key,prefix||'/face.jpg',prefix||'/voice.m4a',(offer->>'price')::integer) returning * into item;
 end if;
 return jsonb_build_object('id',item.id,'photoPath',item.photo_path,'audioPath',item.audio_path,'committed',item.sent_at is not null,'price',item.price_paid);
end $$;
create or replace function public.prepare_burrow_surprise_v1(p_user uuid,p_partner uuid,p_version text,p_key uuid,p_frame text,p_duration integer,p_digest text)
returns jsonb language sql security definer set search_path=public as $$
 select prepare_burrow_surprise_v2(p_user,p_partner,p_version,p_key,p_frame,p_duration,p_digest,null);
$$;
create or replace function public.complete_burrow_surprise_v1(p_user uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item burrow_surprises%rowtype; receipt jsonb; offer jsonb;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('burrow-shop-prices',0));
 partner:=lock_burrow_pair(p_user);
 select * into item from burrow_surprises where id=p_id and sender_id=p_user for update;
 if not found then return jsonb_build_object('error','not_found'); end if;
 if item.expired_at is not null then return jsonb_build_object('error','draft_expired'); end if;
 if partner is null or item.recipient_id<>partner or item.pair_version is distinct from burrow_pair_version_v1(p_user,partner)
 then return jsonb_build_object('error','pair_changed'); end if;
 if item.sent_at is not null then return jsonb_build_object('id',item.id,'applied',false); end if;
 offer:=burrow_service_offer_v1(p_user,'surprise:'||item.frame,'surprise');
 if offer->>'error' is not null then return offer; end if;
 if not exists(select 1 from storage.objects where bucket_id='burrow-surprises' and name=item.photo_path)
  or not exists(select 1 from storage.objects where bucket_id='burrow-surprises' and name=item.audio_path)
 then return jsonb_build_object('error','media_incomplete'); end if;
 -- The upload ticket freezes the explicitly accepted price, not a stale client price.
 receipt:=change_carrot_balance_v1(p_user,-item.price_paid,'surprise_sent','surprise',item.id::text,'surprise:'||item.id::text);
 if receipt->>'error' is not null then return receipt; end if;
 update burrow_surprises set sent_at=now() where id=item.id;
 return jsonb_build_object('id',item.id,'applied',true,'spent',item.price_paid);
end $$;
revoke all on function public.burrow_has_plus_v1(uuid),public.burrow_service_offer_v1(uuid,text,text),
 public.burrow_game_unlock_v2(uuid,text,uuid,integer),public.burrow_game_unlock_v1(uuid,text,uuid),
 public.burrow_game_start_before_catalog_v1(uuid,text,jsonb),public.burrow_game_start_v1(uuid,text,jsonb),
 public.prepare_burrow_surprise_v2(uuid,uuid,text,uuid,text,integer,text,integer),
 public.prepare_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text),public.complete_burrow_surprise_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.burrow_game_start_before_catalog_v1(uuid,text,jsonb) from service_role;
grant execute on function public.burrow_game_unlock_v2(uuid,text,uuid,integer),public.burrow_game_unlock_v1(uuid,text,uuid),
 public.burrow_game_start_v1(uuid,text,jsonb),public.prepare_burrow_surprise_v2(uuid,uuid,text,uuid,text,integer,text,integer),
 public.prepare_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text),public.complete_burrow_surprise_v1(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
