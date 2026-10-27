-- New rooms begin ready for the first feeding/watering interaction.
-- Both paired bootstrap and solo initialization insert only owner_id, so the
-- database defaults are the single source of truth. Never reset existing care.
begin;

alter table public.room_needs
  alter column food_value set default 0,
  alter column water_value set default 0;

commit;
