-- Five selection-only people icons. Idempotent, additive; no history or sharing changes.
-- Apply before deploying the v2 picker so reflect_items foreign keys can resolve.
insert into public.items (id, sheet_id, row, col, display_name, rarity, category) values
  ('tap.person.just_me', 'tap-person-v1', 0, 0, 'Just Me', 'common', 'People & Relationships'),
  ('tap.person.partner', 'tap-person-v1', 0, 1, 'Partner', 'common', 'People & Relationships'),
  ('tap.person.family', 'tap-person-v1', 0, 2, 'Family', 'common', 'People & Relationships'),
  ('tap.person.friends', 'tap-person-v1', 0, 3, 'Friends', 'common', 'People & Relationships'),
  ('tap.person.pets', 'tap-person-v1', 0, 4, 'Pets', 'common', 'People & Relationships')
on conflict (id) do nothing;
