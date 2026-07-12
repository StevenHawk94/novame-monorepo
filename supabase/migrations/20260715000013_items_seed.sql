-- Seed: small-sample items (C8), matching dictionary.json. 480 later.
insert into public.items (id, sheet_id, row, col, display_name, rarity, category) values
  ('food.apple', 'food', 0, 0, 'Apple', 'common', 'food'),
  ('food.coffee', 'food', 0, 1, 'Coffee', 'common', 'drink'),
  ('food.pizza', 'food', 0, 2, 'Pizza', 'uncommon', 'food'),
  ('food.apple_pie', 'food', 0, 3, 'Apple Pie', 'rare', 'food'),
  ('food.tea', 'food', 0, 4, 'Tea', 'common', 'drink'),
  ('nature.rain', 'nature', 0, 0, 'Rain', 'common', 'nature'),
  ('nature.sun', 'nature', 0, 1, 'Sun', 'common', 'nature'),
  ('nature.moon', 'nature', 0, 2, 'Moon', 'uncommon', 'nature'),
  ('nature.flower', 'nature', 0, 3, 'Flower', 'common', 'nature'),
  ('nature.ocean', 'nature', 0, 4, 'Ocean', 'rare', 'nature'),
  ('object.book', 'object', 0, 0, 'Book', 'common', 'object'),
  ('object.guitar', 'object', 0, 1, 'Guitar', 'uncommon', 'object'),
  ('object.candle', 'object', 0, 2, 'Candle', 'common', 'object'),
  ('animal.dog', 'animal', 0, 0, 'Dog', 'common', 'animal'),
  ('animal.cat', 'animal', 0, 1, 'Cat', 'common', 'animal')
on conflict (id) do nothing;
