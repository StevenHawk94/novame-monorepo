-- Plus AI enhancement belongs to the writer. A partner's subscription can
-- extend a paired room, but an unpaired Plus writer keeps their own benefit.
create or replace function public.claim_reflect_ai_enhancement(p_user_id uuid,p_reflect_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r reflects%rowtype; v_is_paid boolean:=false;
  v_major boolean:=exists(select 1 from app_config where key='app_major_update_enabled' and value in('true','1'));
  v_partner uuid; v_has_consent boolean:=false; v_used integer:=0; v_eligible boolean:=false;
begin
  if v_major then
    v_partner:=lock_burrow_pair(p_user_id);
    perform pg_advisory_xact_lock(hashtextextended('adventure:'||p_user_id::text,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into r from reflects where id=p_reflect_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select coalesce(subscription_tier::text<>'free',false),ai_consent_at is not null
    into v_is_paid,v_has_consent from profiles where id=p_user_id;
  select count(*)::integer into v_used from plus_journal_ai_credits
    where user_id=p_user_id and local_date=r.local_date;
  if v_major then
    select exists(select 1 from profiles where id in(p_user_id,v_partner)
      and subscription_tier::text<>'free') into v_is_paid;
  end if;
  if v_is_paid and v_has_consent and btrim(coalesce(r.body,''))<>'' then
    if r.journal_kind='remember_together' and not v_major then v_eligible:=true;
    elsif r.journal_kind in('write_freely','tap_your_day') then
      if exists(select 1 from plus_journal_ai_credits where reflect_id=p_reflect_id)
        then v_eligible:=true;
      elsif v_major or v_used<2 then
        insert into plus_journal_ai_credits(reflect_id,user_id,local_date,journal_kind)
          values(p_reflect_id,p_user_id,r.local_date,r.journal_kind)
          on conflict(reflect_id) do nothing;
        v_eligible:=true;v_used:=v_used+1;
      end if;
    end if;
  end if;
  update reflect_drafts set ai_enhancement_eligible=v_eligible where user_id=p_user_id
    and (saved_reflect_id=p_reflect_id or finalized_reflect_id=p_reflect_id);
  return jsonb_build_object('error',null,'eligible',v_eligible,'plus_ai_used',v_used,
    'plus_ai_remaining',case when v_major then null when v_is_paid then greatest(0,2-v_used) else 0 end);
end $$;
revoke all on function public.claim_reflect_ai_enhancement(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_reflect_ai_enhancement(uuid,uuid) to service_role;
notify pgrst,'reload schema';
