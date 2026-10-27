-- Add completion-only Surprise Moments. Old clients ignore the new event kind;
-- sending, pricing, receipt recovery, permissions and delivery stay unchanged.
begin;
alter table public.moment_events drop constraint if exists moment_events_event_type_check;
alter table public.moment_events add constraint moment_events_event_type_check check(event_type in (
  'adventure_record_saved','adventure_completed','friend_discovered','affection_sent',
  'room_need_refilled','room_media_updated','gift_sent','gift_claimed','memory_created',
  'game_played','toy_interacted','room_decor_changed','rage_room_completed','surprise_sent'
));

-- Snapshot public product labels so a later rename/archive cannot change the
-- meaning of a successfully sent gift. Legacy events resolve via the catalogue.
create or replace function public.burrow_gift_moment_labels_v1() returns trigger
language plpgsql security definer set search_path=public as $$
declare item_name text; item_category text;
begin
  if new.event_type='gift_sent' then
    select title,category into item_name,item_category from public.catalog_items
      where stable_id=new.payload->>'itemId';
    if found then new.payload:=new.payload||jsonb_build_object('productName',item_name,'productCategory',item_category); end if;
  end if;
  return new;
end $$;
drop trigger if exists burrow_gift_moment_labels on public.moment_events;
create trigger burrow_gift_moment_labels before insert on public.moment_events
  for each row execute function public.burrow_gift_moment_labels_v1();

create or replace function public.burrow_surprise_sent_moment_v1() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  -- Prepare/upload/open/receipt retries are not sends. This runs in the same
  -- transaction as the first successful paid completion, once per Surprise ID.
  if new.sent_at is not null and old.sent_at is null then
    insert into public.moment_events(pair_low,pair_high,actor_id,target_id,pair_version,
      event_type,reference_type,reference_id,payload,idempotency_key,created_at)
    values(least(new.sender_id,new.recipient_id),greatest(new.sender_id,new.recipient_id),
      new.sender_id,new.recipient_id,new.pair_version,'surprise_sent','surprise',new.id::text,
      '{}'::jsonb,'surprise-sent:'||new.id::text,new.sent_at)
    on conflict(actor_id,idempotency_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists burrow_surprise_sent_moment on public.burrow_surprises;
create trigger burrow_surprise_sent_moment after update of sent_at on public.burrow_surprises
  for each row execute function public.burrow_surprise_sent_moment_v1();
revoke all on function public.burrow_gift_moment_labels_v1(),public.burrow_surprise_sent_moment_v1() from public,anon,authenticated;
grant execute on function public.burrow_gift_moment_labels_v1(),public.burrow_surprise_sent_moment_v1() to service_role;
commit;
