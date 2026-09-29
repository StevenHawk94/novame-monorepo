-- Replaceable placeholder content for the Burrow vertical slice. Stable IDs
-- survive later copy/art replacement; is_placeholder makes unfinished content
-- visible to admin and release checks.

insert into public.content_revisions(id, status, minimum_app_version, published_at)
values ('burrow-v1-placeholder', 'published', null, now())
on conflict (id) do update set
  status = excluded.status,
  published_at = coalesce(public.content_revisions.published_at, excluded.published_at);

insert into public.catalog_items(
  stable_id, revision_id, item_type, category, title, description, price,
  plus_only, tradable, tags, drop_weight, asset, is_placeholder
)
values
  ('room_cozy_cave_01', 'burrow-v1-placeholder', 'room', 'rooms', 'Cozy Cave', 'A warm default room for the first Burrow build.', 0, false, false, array['cozy','home'], 0, '{"renderer":"native","palette":"terracotta"}', true),
  ('outfit_explorer_01', 'burrow-v1-placeholder', 'outfit', 'outfits', 'Little Explorer', 'A practical outfit for today’s adventure.', 0, false, false, array['adventure','outfit'], 0, '{"renderer":"existing_outfit","outfitIndex":1}', true),
  ('window_sunny_01', 'burrow-v1-placeholder', 'decor', 'windows', 'Sunny Window', 'A bright view of the hills.', 0, false, true, array['window','sunny'], 0, '{"renderer":"native","symbol":"window","anchorX":0.32,"anchorY":0.37,"widthRatio":0.23,"zIndex":20}', true),
  ('lamp_acorn_01', 'burrow-v1-placeholder', 'decor', 'lamps', 'Acorn Lamp', 'A soft light grown from an acorn.', 0, false, true, array['lamp','warm'], 5, '{"renderer":"native","symbol":"lamp","anchorX":0.15,"anchorY":0.58,"widthRatio":0.17,"zIndex":30}', true),
  ('plant_daisy_01', 'burrow-v1-placeholder', 'decor', 'plants', 'Daisy Pot', 'A cheerful pot of cave daisies.', 0, false, true, array['plant','flower'], 5, '{"renderer":"native","symbol":"plant","anchorX":0.74,"anchorY":0.58,"widthRatio":0.18,"zIndex":34}', true),
  ('decor_leaf_frame_01', 'burrow-v1-placeholder', 'decor', 'decor', 'Leaf Frame', 'A simple leaf print for the wall.', 0, false, true, array['decor','leaf'], 4, '{"renderer":"native","symbol":"leaf","anchorX":0.72,"anchorY":0.38,"widthRatio":0.14,"zIndex":22}', true),
  ('cushion_moss_01', 'burrow-v1-placeholder', 'decor', 'cushions', 'Moss Cushion', 'A soft place for a tired bunny.', 0, false, true, array['cushion','moss'], 6, '{"renderer":"native","symbol":"cushion","anchorX":0.31,"anchorY":0.69,"widthRatio":0.32,"zIndex":42}', true),
  ('table_stump_01', 'burrow-v1-placeholder', 'decor', 'tables', 'Stump Table', 'A sturdy table with a tiny letter.', 0, false, true, array['table','wood'], 4, '{"renderer":"native","symbol":"table","anchorX":0.72,"anchorY":0.69,"widthRatio":0.25,"zIndex":41}', true),
  ('rug_leaf_01', 'burrow-v1-placeholder', 'decor', 'rugs', 'Leaf Rug', 'A woven rug inspired by forest leaves.', 0, false, true, array['rug','leaf'], 4, '{"renderer":"native","symbol":"rug","anchorX":0.62,"anchorY":0.78,"widthRatio":0.38,"zIndex":10}', true),
  ('storage_burrow_01', 'burrow-v1-placeholder', 'decor', 'storage', 'Burrow Cabinet', 'A little cabinet for important things.', 0, false, true, array['storage','cabinet'], 3, '{"renderer":"native","symbol":"cabinet","anchorX":0.55,"anchorY":0.51,"widthRatio":0.26,"zIndex":28}', true),
  ('wall_art_oak_01', 'burrow-v1-placeholder', 'decor', 'wall_art', 'Old Oak Poster', 'A keepsake from the forest path.', 0, false, true, array['poster','oak'], 4, '{"renderer":"native","symbol":"poster","anchorX":0.48,"anchorY":0.35,"widthRatio":0.13,"zIndex":21}', true),
  ('music_quiet_cave_01', 'burrow-v1-placeholder', 'music', 'music', 'Quiet Cave', 'A gentle original ambient loop placeholder.', 0, false, false, array['music','ambient'], 0, '{"renderer":"none","loop":true}', true),
  ('our_room_cloud_bed_01', 'burrow-v1-placeholder', 'our_room', 'our_room', 'Cloud Bed', 'A shared resting place for two bunnies.', 0, false, false, array['our_room','bed'], 0, '{"renderer":"native","symbol":"bed","anchorX":0.5,"anchorY":0.53,"widthRatio":0.72,"zIndex":30}', true),
  ('adventure_fossil_lamp_01', 'burrow-v1-placeholder', 'decor', 'lamps', 'Fossil Lamp', 'A glowing fossil uncovered deep below.', null, false, true, array['fossil','quiet','reflection'], 10, '{"renderer":"native","symbol":"fossil"}', true),
  ('adventure_moon_pebble_01', 'burrow-v1-placeholder', 'souvenir', 'gifts', 'Moon Pebble', 'A smooth pebble that catches pale light.', null, false, true, array['night','calm','walk'], 10, '{"renderer":"native","symbol":"moon"}', true),
  ('adventure_forest_letter_01', 'burrow-v1-placeholder', 'souvenir', 'gifts', 'Forest Letter', 'A sealed note from an old oak.', null, false, true, array['message','partner','forest'], 10, '{"renderer":"native","symbol":"letter"}', true),
  ('adventure_lucky_charm_01', 'burrow-v1-placeholder', 'souvenir', 'gifts', 'Lucky Charm', 'A four-leaf charm found beside the trail.', null, false, true, array['luck','small_win'], 10, '{"renderer":"native","symbol":"clover"}', true),
  ('adventure_flower_seed_01', 'burrow-v1-placeholder', 'souvenir', 'gifts', 'Flower Seed', 'A seed waiting for a shared sunny day.', null, false, true, array['flower','growth','gratitude'], 10, '{"renderer":"native","symbol":"seed"}', true),
  ('adventure_soft_feather_01', 'burrow-v1-placeholder', 'souvenir', 'gifts', 'Soft Feather', 'A soft reminder to move gently.', null, false, true, array['rest','gentle','care'], 10, '{"renderer":"native","symbol":"feather"}', true)
on conflict (stable_id) do nothing;

insert into public.friend_definitions(
  stable_id, revision_id, name, subtitle, rarity, art, tags, is_placeholder
)
values
  ('friend_mr_mole_v1', 'burrow-v1-placeholder', 'Mr. Mole', 'Keeper of Buried Stories', 'common', '{"renderer":"native","symbol":"mole"}', array['memory','story'], true),
  ('friend_pip_frog_v1', 'burrow-v1-placeholder', 'Pip', 'Listener by the Lily Pond', 'common', '{"renderer":"native","symbol":"frog"}', array['calm','care'], true),
  ('friend_fenn_fox_v1', 'burrow-v1-placeholder', 'Fenn', 'Finder of Small Bright Things', 'common', '{"renderer":"native","symbol":"fox"}', array['curiosity','small_win'], true)
on conflict (stable_id) do nothing;

insert into public.friend_content(
  friend_id, content_type, prompt, choices, feedback, rage_monster_id,
  locale, position, is_placeholder
)
values
  ('friend_mr_mole_v1', 'question', 'Which little moment from today would you keep?', '[{"id":"funniest","label":"The funniest part"},{"id":"quietest","label":"The quietest part"},{"id":"share","label":"The part I would tell my person"}]', '{"funniest":"Joy leaves a bright trail.","quietest":"Quiet moments can be worth keeping.","share":"Shared stories make the burrow warmer."}', null, 'en', 1, true),
  ('friend_mr_mole_v1', 'insight', 'Small stories become easier to remember when you give them a name.', '[]', '{}', null, 'en', 2, true),
  ('friend_mr_mole_v1', 'emotional_help', 'A heavy thought is blocking the tunnel. Would you like help facing it?', '[{"id":"yes","label":"Yes, help me"},{"id":"not_now","label":"Not now"}]', '{}', 'shadow_thought', 'en', 3, true),
  ('friend_pip_frog_v1', 'question', 'What helped you breathe a little easier today?', '[{"id":"person","label":"A person"},{"id":"place","label":"A place"},{"id":"pause","label":"A quiet pause"}]', '{"person":"Care can arrive through small gestures.","place":"Some places lend us their calm.","pause":"A pause can be a real part of the day."}', null, 'en', 1, true),
  ('friend_pip_frog_v1', 'insight', 'Rest is not an empty space. It is part of the path.', '[]', '{}', null, 'en', 2, true),
  ('friend_pip_frog_v1', 'emotional_help', 'Something noisy followed you home. Want to quiet it together?', '[{"id":"yes","label":"Let us try"},{"id":"not_now","label":"Not now"}]', '{}', 'noise_cloud', 'en', 3, true),
  ('friend_fenn_fox_v1', 'question', 'Where did you notice something unexpectedly good?', '[{"id":"work","label":"In the middle of work"},{"id":"outside","label":"While I was out"},{"id":"home","label":"Back at home"}]', '{"work":"A bright detail can change the shape of a busy hour.","outside":"Curiosity keeps the map growing.","home":"Familiar places still hold surprises."}', null, 'en', 1, true),
  ('friend_fenn_fox_v1', 'insight', 'The day often hides its best detail somewhere ordinary.', '[]', '{}', null, 'en', 2, true),
  ('friend_fenn_fox_v1', 'emotional_help', 'A worry is guarding a bright thing. Want to meet it in the Rage Room?', '[{"id":"yes","label":"Take me there"},{"id":"not_now","label":"Not now"}]', '{}', 'worry_guard', 'en', 3, true)
on conflict do nothing;

insert into public.memory_prompts(
  stable_id, revision_id, prompt, locale, position, is_placeholder
)
select
  'memory_prompt_' || lpad(ordinality::text, 2, '0'),
  'burrow-v1-placeholder',
  prompt,
  'en',
  ordinality::integer,
  true
from unnest(array[
  'What small moment would you like us to remember from today?',
  'What made you think of your person today?',
  'What felt unexpectedly gentle today?',
  'What made you laugh, even for a second?',
  'What did you do today that you are quietly proud of?',
  'What part of today would you replay?',
  'What ordinary detail felt special?',
  'What do you wish your person had seen today?',
  'What helped you feel more like yourself?',
  'What felt difficult but worth getting through?',
  'What are you grateful your person understands about you?',
  'What did you notice on the way home?',
  'What are you looking forward to together?',
  'What comforted you today?',
  'What surprised you about your own reaction?',
  'What did someone do that stayed with you?',
  'What would you put in a tiny time capsule from today?',
  'What song, sound, or silence matched your day?',
  'What did your body ask you for today?',
  'What felt easier than it used to?',
  'What would you thank your past self for?',
  'What did you learn about your person recently?',
  'What shared habit feels like home?',
  'What made the distance feel smaller?',
  'What would make tomorrow a little kinder?',
  'What did you choose not to rush today?',
  'What tiny win deserves more credit?',
  'What question would you like to ask your person?',
  'What do you hope you both remember a year from now?',
  'What part of today needs no explanation, only keeping?'
]) with ordinality as prompts(prompt, ordinality)
on conflict (stable_id) do nothing;

create table if not exists public.moment_templates (
  stable_id text primary key,
  revision_id text not null references public.content_revisions(id),
  event_type text not null,
  actor_copy text not null,
  partner_copy text not null,
  cta text,
  locale text not null default 'en',
  is_placeholder boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active', 'retired'))
);

alter table public.moment_templates enable row level security;
drop policy if exists moment_templates_public_read on public.moment_templates;
create policy moment_templates_public_read on public.moment_templates
  for select to anon, authenticated using (status = 'active');
drop policy if exists moment_templates_service on public.moment_templates;
create policy moment_templates_service on public.moment_templates
  for all to service_role using (true) with check (true);
grant select on public.moment_templates to anon, authenticated;
grant all on public.moment_templates to service_role;

insert into public.moment_templates(
  stable_id, revision_id, event_type, actor_copy, partner_copy, cta, is_placeholder
)
values
  ('moment_adventure_record_saved', 'burrow-v1-placeholder', 'adventure_record_saved', 'You shared a day.', '{{actor}} shared a day.', null, true),
  ('moment_adventure_completed', 'burrow-v1-placeholder', 'adventure_completed', 'Your bunny returned from an adventure.', '{{actor}}''s bunny returned from an adventure.', 'View reward', true),
  ('moment_friend_discovered', 'burrow-v1-placeholder', 'friend_discovered', 'You met {{friend}}.', '{{actor}} met {{friend}}.', 'Meet friend', true),
  ('moment_affection_sent', 'burrow-v1-placeholder', 'affection_sent', 'You sent {{affection}}.', '{{actor}} sent you {{affection}}.', 'Send some back', true),
  ('moment_room_need_refilled', 'burrow-v1-placeholder', 'room_need_refilled', 'You cared for {{target}}''s room.', '{{actor}} cared for your room.', null, true),
  ('moment_room_media_updated', 'burrow-v1-placeholder', 'room_media_updated', 'You updated {{media}}.', '{{actor}} updated {{media}}.', 'View room', true),
  ('moment_gift_sent', 'burrow-v1-placeholder', 'gift_sent', 'You sent a gift.', '{{actor}} sent you a gift.', 'Open gift', true),
  ('moment_gift_claimed', 'burrow-v1-placeholder', 'gift_claimed', 'You opened a gift.', '{{actor}} opened your gift.', null, true),
  ('moment_memory_created', 'burrow-v1-placeholder', 'memory_created', 'You saved a memory.', '{{actor}} saved a memory.', 'View memory', true)
on conflict (stable_id) do nothing;

notify pgrst, 'reload schema';
