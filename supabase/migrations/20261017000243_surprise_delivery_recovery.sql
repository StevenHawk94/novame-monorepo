-- Receipt lookup never uploads or spends. It verifies the current relationship
-- generation before returning the sender's own immutable send acknowledgement.
create function public.burrow_surprise_send_status_v1(p_user uuid,p_key uuid,p_partner uuid,p_version text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item burrow_surprises%rowtype;
begin
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if partner is distinct from p_partner or p_version is null or p_version is distinct from burrow_pair_version_v1(p_user,partner)
 then return jsonb_build_object('error','pair_changed'); end if;
 select * into item from burrow_surprises where sender_id=p_user and idempotency_key=p_key;
 if not found then return jsonb_build_object('committed',false); end if;
 if item.recipient_id is distinct from partner or item.pair_version is distinct from p_version
 then return jsonb_build_object('error','pair_changed'); end if;
 return jsonb_build_object('committed',item.sent_at is not null,'id',item.id,'sentAt',item.sent_at,'durationMs',item.duration_ms);
end $$;
revoke all on function public.burrow_surprise_send_status_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.burrow_surprise_send_status_v1(uuid,uuid,uuid,text) to service_role;

-- Only committed sends / first-open receipts notify. Unpaid upload tickets do
-- not announce a gift. Existing private per-user channels/policies are reused.
create function public.broadcast_surprise_delivery_v1() returns trigger
language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 if new.sent_at is null then return new; end if;
 if tg_op='UPDATE' and new.sent_at is not distinct from old.sent_at and new.opened_at is not distinct from old.opened_at then return new; end if;
 if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
  foreach target in array array[new.sender_id,new.recipient_id] loop
   begin
    perform realtime.send('{}'::jsonb,'surprise_changed','burrow:'||target::text,true);
   exception when others then
    -- Notification transport is recoverable by foreground/periodic reads and
    -- must never turn a valid, atomic paid send into a failed transaction.
    raise warning 'Surprise notification unavailable';
   end;
  end loop;
 end if;
 return new;
end $$;
revoke all on function public.broadcast_surprise_delivery_v1() from public,anon,authenticated;
create trigger surprise_delivery_changed after insert or update of sent_at,opened_at on public.burrow_surprises
for each row execute function public.broadcast_surprise_delivery_v1();
notify pgrst,'reload schema';
