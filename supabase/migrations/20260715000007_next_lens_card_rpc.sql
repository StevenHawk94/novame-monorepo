-- next_lens_card: the card a user should see next in a theme, by cursor (C5).
--
-- The next active card with sort_order strictly greater than the user's cursor;
-- if none (end reached), wrap to the lowest active. A new user (cursor -1 or no
-- progress row) gets the lowest. Read-only -- does NOT advance the cursor (that
-- happens on completion, in submit_lens). Returns the card as jsonb, or
-- {found:false} if the theme has no active cards.
create or replace function public.next_lens_card(
  p_user_id uuid,
  p_theme   dimension_t
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor int;
  v_card   public.lens_cards;
begin
  select last_card_order into v_cursor
  from public.lens_progress
  where user_id = p_user_id and theme = p_theme;
  if not found then
    v_cursor := -1;
  end if;

  select * into v_card
  from public.lens_cards
  where theme = p_theme and is_active and sort_order > v_cursor
  order by sort_order
  limit 1;

  if not found then
    select * into v_card
    from public.lens_cards
    where theme = p_theme and is_active
    order by sort_order
    limit 1;
  end if;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'card_id', v_card.id,
    'theme', v_card.theme,
    'sort_order', v_card.sort_order,
    'headline', v_card.headline,
    'body', v_card.body
  );
end;
$$;

revoke all on function public.next_lens_card(uuid, dimension_t) from public;
revoke all on function public.next_lens_card(uuid, dimension_t) from anon;
revoke all on function public.next_lens_card(uuid, dimension_t) from authenticated;
grant execute on function public.next_lens_card(uuid, dimension_t) to service_role;
