-- reflects.source_kit: which Kit routed the user into this reflection (C5).
--
-- New Lens's "I see it differently" sends the user to Reflect; this records that
-- origin so New Lens -> Reflect conversion is analyzable, without overloading
-- prompt_id (which says WHICH prompt -- a separate concern from WHERE the user
-- came from). Null for a normal reflect the user started themselves. Additive
-- and nullable, matching the strictly-additive schema policy until the C12 ETL.
alter table public.reflects
  add column if not exists source_kit kit_t;
