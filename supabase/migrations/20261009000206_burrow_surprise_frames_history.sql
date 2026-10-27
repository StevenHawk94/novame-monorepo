-- Supplied local frames, with legacy identifiers retained for old surprises.
alter table public.burrow_surprises drop constraint burrow_surprises_frame_check;
alter table public.burrow_surprises add constraint burrow_surprises_frame_check check(frame in('santa','bunny','flower','heart','birthday','star','halloween','valentine','new_year','easter','good_morning','good_night','sweet_dreams','kiss_you','cuddle_time','thank_you','movie_night','dinner_date','spicy_mood','you_got_this','proud_of_you','feel_better','welcome_home'));

create or replace function public.prepare_burrow_surprise_v1(p_user uuid,p_partner uuid,p_version text,p_key uuid,p_frame text,p_duration integer,p_digest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; item burrow_surprises%rowtype; prefix text;
begin
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('error','not_paired'); end if;
 if partner is distinct from p_partner or p_version is distinct from burrow_pair_version_v1(p_user,partner) or p_version is null
 then return jsonb_build_object('error','pair_changed'); end if;
 if p_key is null or p_frame is null or p_frame not in('santa','bunny','flower','heart','birthday','star','halloween','valentine','new_year','easter','good_morning','good_night','sweet_dreams','kiss_you','cuddle_time','thank_you','movie_night','dinner_date','spicy_mood','you_got_this','proud_of_you','feel_better','welcome_home')
 or p_duration is null or p_duration not between 1000 and 60000 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
 then return jsonb_build_object('error','invalid_request'); end if;
 select * into item from burrow_surprises where sender_id=p_user and idempotency_key=p_key for update;
 if found then
  if item.expired_at is not null then return jsonb_build_object('error','draft_expired'); end if;
  if item.digest<>p_digest or item.pair_version<>p_version or item.recipient_id<>p_partner or item.frame<>p_frame or item.duration_ms<>p_duration
  then return jsonb_build_object('error','idempotency_conflict'); end if;
 else
  if coalesce((select carrot_balance from wallets where user_id=p_user),0)<300 then return jsonb_build_object('error','insufficient_balance'); end if;
  prefix:=p_user::text||'/'||p_key::text;
  insert into burrow_surprises(sender_id,recipient_id,pair_version,frame,duration_ms,digest,idempotency_key,photo_path,audio_path)
  values(p_user,p_partner,p_version,p_frame,p_duration,p_digest,p_key,prefix||'/face.jpg',prefix||'/voice.m4a') returning * into item;
 end if;
 return jsonb_build_object('id',item.id,'photoPath',item.photo_path,'audioPath',item.audio_path,'committed',item.sent_at is not null);
end $$;

-- Keyset pagination: no offset scans, duplicate rows, or private file keys in history.
create index burrow_surprise_sent_history on public.burrow_surprises(sender_id,sent_at desc,id desc) where sent_at is not null;
create index burrow_surprise_received_history on public.burrow_surprises(recipient_id,sent_at desc,id desc) where sent_at is not null;
create function public.burrow_surprise_history_v1(p_user uuid,p_direction text,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare partner uuid; version text; items jsonb; more boolean; last_item jsonb;
begin
 if p_direction is null or p_direction not in('received','sent') or (p_before is null)<>(p_before_id is null)
 then return jsonb_build_object('error','invalid_request'); end if;
 partner:=lock_burrow_pair(p_user);
 if partner is null then return jsonb_build_object('items','[]'::jsonb,'nextCursor',null); end if;
 version:=burrow_pair_version_v1(p_user,partner);
 select coalesce(jsonb_agg(to_jsonb(s) order by s.sent_at desc,s.id desc),'[]'::jsonb) into items from (
  select id,sender_id,recipient_id,frame,duration_ms,sent_at,opened_at from burrow_surprises
  where sent_at is not null and pair_version=version
  and ((p_direction='sent' and sender_id=p_user and recipient_id=partner)
    or (p_direction='received' and recipient_id=p_user and sender_id=partner))
  and (p_before is null or (sent_at,id)<(p_before,p_before_id))
  order by sent_at desc,id desc limit 21
 ) s;
 more:=jsonb_array_length(items)>20;
 if more then items:=items-20; end if;
 last_item:=items->19;
 return jsonb_build_object('items',items,'nextCursor',case when more then jsonb_build_object('sentAt',last_item->>'sent_at','id',last_item->>'id') else null end);
end $$;
revoke all on function public.burrow_surprise_history_v1(uuid,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.burrow_surprise_history_v1(uuid,text,timestamptz,uuid) to service_role;
notify pgrst,'reload schema';
