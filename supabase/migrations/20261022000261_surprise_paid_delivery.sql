-- New composers pay with metadata first, then upload privately. Legacy sends
-- retain upload-then-pay. Only sent_at publishes a gift, Moment or notification.
begin;
alter table public.burrow_surprises add column paid_at timestamptz;
alter table public.burrow_surprises add column refunded_at timestamptz;
create index burrow_surprise_pending_paid on public.burrow_surprises(created_at,id)
 where paid_at is not null and sent_at is null and expired_at is null;
create index burrow_surprise_wallet_paid on public.burrow_surprises(sender_id,sent_at)
 where paid_at is not null and refunded_at is null;

create function public.pay_burrow_surprise_v1(p_user uuid,p_partner uuid,p_version text,p_key uuid,p_frame text,p_duration integer,p_digest text,p_expected_price integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket jsonb; item burrow_surprises%rowtype; receipt jsonb;
begin
 ticket:=prepare_burrow_surprise_v2(p_user,p_partner,p_version,p_key,p_frame,p_duration,p_digest,p_expected_price);
 if ticket->>'error' is not null then return ticket; end if;
 select * into item from burrow_surprises where id=(ticket->>'id')::uuid for update;
 if item.sent_at is not null then return ticket||jsonb_build_object('paid',true); end if;
 if item.paid_at is null then
  receipt:=change_carrot_balance_v1(p_user,-item.price_paid,'surprise_sent','surprise',item.id::text,'surprise:'||item.id::text);
  if receipt->>'error' is not null then return receipt; end if;
  update burrow_surprises set paid_at=now() where id=item.id;
 end if;
 return ticket||jsonb_build_object('paid',true);
end $$;

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
 if item.sent_at is not null then return jsonb_build_object('id',item.id,'applied',false,'sentAt',item.sent_at); end if;
 -- A paid order owns the accepted frame/price; later price or Plus changes
 -- cannot invalidate that purchase. Unpaid legacy tickets still revalidate.
 if item.paid_at is null then
  offer:=burrow_service_offer_v1(p_user,'surprise:'||item.frame,'surprise');
  if offer->>'error' is not null then return offer; end if;
 end if;
 if not exists(select 1 from storage.objects where bucket_id='burrow-surprises' and name=item.photo_path)
  or not exists(select 1 from storage.objects where bucket_id='burrow-surprises' and name=item.audio_path)
 then return jsonb_build_object('error','media_incomplete'); end if;
 if item.paid_at is null then
  receipt:=change_carrot_balance_v1(p_user,-item.price_paid,'surprise_sent','surprise',item.id::text,'surprise:'||item.id::text);
  if receipt->>'error' is not null then return receipt; end if;
 end if;
 update burrow_surprises set sent_at=now() where id=item.id;
 return jsonb_build_object('id',item.id,'applied',true,'spent',item.price_paid,'sentAt',now());
end $$;

-- Sender-owned cancellation works even after unpairing. Never refund a send
-- already delivered. Exact restitution bypasses the daily reward cap only here.
create function public.cancel_paid_burrow_surprise_v1(p_user uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item burrow_surprises%rowtype; balance integer;
begin
 perform lock_burrow_pair(p_user);
 select * into item from burrow_surprises where sender_id=p_user and idempotency_key=p_key for update;
 if not found then return jsonb_build_object('cancelled',true,'refunded',false); end if;
 if item.sent_at is not null then return jsonb_build_object('committed',true,'id',item.id,'sentAt',item.sent_at); end if;
 if item.refunded_at is not null then return jsonb_build_object('cancelled',true,'refunded',true); end if;
 if item.paid_at is not null then
  perform pg_advisory_xact_lock(hashtextextended('wallet:'||p_user::text,0));
  update wallets set carrot_balance=carrot_balance+item.price_paid,version=version+1,updated_at=now()
   where user_id=p_user returning carrot_balance into balance;
  insert into currency_ledger(user_id,requested_delta,delta,balance_after,reason,reference_type,reference_id,idempotency_key)
   values(p_user,item.price_paid,item.price_paid,balance,'surprise_refund','surprise',item.id::text,'surprise-refund:'||item.id::text);
 end if;
 update burrow_surprises set expired_at=now(),refunded_at=case when paid_at is not null then now() end where id=item.id;
 return jsonb_build_object('cancelled',true,'refunded',item.paid_at is not null);
end $$;

create or replace function public.burrow_surprise_send_status_v1(p_user uuid,p_key uuid,p_partner uuid,p_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item burrow_surprises%rowtype;
begin
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if partner is distinct from p_partner or p_version is null or p_version is distinct from burrow_pair_version_v1(p_user,partner)
 then return jsonb_build_object('error','pair_changed'); end if;
 select * into item from burrow_surprises where sender_id=p_user and idempotency_key=p_key;
 if not found then return jsonb_build_object('committed',false,'paid',false); end if;
 if item.recipient_id is distinct from partner or item.pair_version is distinct from p_version then return jsonb_build_object('error','pair_changed'); end if;
 if item.expired_at is not null then return jsonb_build_object('error','draft_expired'); end if;
 return jsonb_build_object('committed',item.sent_at is not null,'paid',item.paid_at is not null,'id',item.id,'sentAt',item.sent_at,'durationMs',item.duration_ms);
end $$;

-- A concurrent bootstrap can contain the debit before its HTTP receipt. Expose
-- only the viewer's own paid keys, in the SAME MVCC snapshot as their wallet.
create or replace function public.burrow_reward_wallet_state_v1(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'wallet',jsonb_build_object('balance',w.carrot_balance,'version',w.version),
  'localDate',(now() at time zone coalesce(nullif(p.timezone_name,''),'UTC'))::date,
  'timezone',coalesce(nullif(p.timezone_name,''),'UTC'),'serverNow',now(),
  'spends',coalesce((select jsonb_agg('surprise-send:'||s.idempotency_key::text) from burrow_surprises s
    where s.sender_id=p_user_id and s.paid_at is not null and s.refunded_at is null
      and (s.sent_at is null or s.sent_at>=now()-interval '8 days')),'[]'::jsonb),
  'credits',coalesce((select jsonb_agg(jsonb_build_object('key',l.idempotency_key,'amount',l.delta,'reason',l.reason))
    from currency_ledger l where l.user_id=p_user_id and l.requested_delta>0 and l.created_at>=now()-interval '8 days'),'[]'::jsonb)
 ) from wallets w join profiles p on p.id=w.user_id where w.user_id=p_user_id;
$$;

-- Complete orphaned uploaded orders first. Preserve the existing seven-day
-- abandoned-upload window, but paid incomplete orders MUST be refunded before
-- expiry (including lost devices/local drafts). Transient failures keep retrying.
create function public.recover_paid_burrow_surprises_v1() returns jsonb
language plpgsql security definer set search_path=public as $$
declare item record; result jsonb; done integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('surprise-paid-recovery',0)) then return jsonb_build_object('completed',0,'busy',true); end if;
 for item in select s.sender_id,s.id,s.idempotency_key,s.created_at from burrow_surprises s where s.paid_at is not null
  and s.sent_at is null and s.expired_at is null and (
   s.created_at<now()-interval '7 days' or s.pair_version is distinct from burrow_pair_version_v1(s.sender_id,s.recipient_id) or (
    exists(select 1 from storage.objects o where o.bucket_id='burrow-surprises' and o.name=s.photo_path) and
    exists(select 1 from storage.objects o where o.bucket_id='burrow-surprises' and o.name=s.audio_path)))
  order by s.created_at limit 100 loop
  result:=complete_burrow_surprise_v1(item.sender_id,item.id);
  if result->>'error'='pair_changed' or (result->>'error'='media_incomplete' and item.created_at<now()-interval '7 days')
   then perform cancel_paid_burrow_surprise_v1(item.sender_id,item.idempotency_key);
  elsif result->>'error' is null then done:=done+1; end if;
 end loop;
 return jsonb_build_object('completed',done);
end $$;
create or replace function public.collect_surprise_garbage_v1() returns jsonb
language plpgsql security definer set search_path=public as $$
declare paths jsonb;
begin
 with abandoned as (select id from burrow_surprises where sent_at is null and paid_at is null and expired_at is null
  and created_at<now()-interval '7 days' order by created_at for update skip locked limit 100)
 update burrow_surprises set expired_at=now() where id in(select id from abandoned);
 select coalesce(jsonb_agg(name),'[]'::jsonb) into paths from (
  select o.name from storage.objects o left join burrow_surprises s on o.name in(s.photo_path,s.audio_path)
  where o.bucket_id='burrow-surprises' and o.created_at<now()-interval '1 day' and (s.id is null or s.expired_at is not null)
  order by o.created_at limit 100) garbage;
 return paths;
end $$;
revoke all on function public.pay_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text,integer),public.cancel_paid_burrow_surprise_v1(uuid,uuid),public.recover_paid_burrow_surprises_v1() from public,anon,authenticated;
grant execute on function public.pay_burrow_surprise_v1(uuid,uuid,text,uuid,text,integer,text,integer),public.cancel_paid_burrow_surprise_v1(uuid,uuid),public.recover_paid_burrow_surprises_v1() to service_role;
notify pgrst,'reload schema';
commit;
