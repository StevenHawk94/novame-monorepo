-- Publish the illustrated adventure friends supplied with the Burrow art.
-- Existing discoveries retain their stable IDs; new friends add to the pool.
update public.friend_definitions
set art='{"renderer":"bundled","key":"Mr Mole"}'::jsonb,is_placeholder=false,
  updated_at=now()
where stable_id='friend_mr_mole_v1';

insert into public.friend_definitions
  (stable_id,revision_id,name,subtitle,rarity,art,tags,is_placeholder)
values
  ('friend_miss_armadillo_v1','burrow-v1-placeholder','Miss Armadillo','Collector of little comforts','common','{"renderer":"bundled","key":"Miss Armadillo"}',array['comfort','home'],false),
  ('friend_miss_frog_v1','burrow-v1-placeholder','Miss Frog','Keeper of quiet ponds','common','{"renderer":"bundled","key":"Miss Frog"}',array['rest','nature'],false),
  ('friend_mr_badger_v1','burrow-v1-placeholder','Mr Badger','Maker of brave paths','common','{"renderer":"bundled","key":"Mr Badger"}',array['courage','care'],false),
  ('friend_mr_hedgehog_v1','burrow-v1-placeholder','Mr Hedgehog','Guardian of gentle boundaries','common','{"renderer":"bundled","key":"Mr Hedgehog"}',array['boundaries','kindness'],false),
  ('friend_mr_pocket_gopher_v1','burrow-v1-placeholder','Mr Pocket Gopher','Saver of small treasures','common','{"renderer":"bundled","key":"Mr Pocket Gopher"}',array['memory','treasure'],false),
  ('friend_mr_prairie_dog_v1','burrow-v1-placeholder','Mr Prairie Dog','Messenger from the meadow','common','{"renderer":"bundled","key":"Mr Prairie Dog"}',array['connection','conversation'],false),
  ('friend_mr_wombat_v1','burrow-v1-placeholder','Mr Wombat','Builder of cozy places','common','{"renderer":"bundled","key":"Mr Wombat"}',array['home','rest'],false),
  ('friend_mrs_aardvark_v1','burrow-v1-placeholder','Mrs Aardvark','Finder of hidden paths','common','{"renderer":"bundled","key":"Mrs Aardvark"}',array['curiosity','adventure'],false),
  ('friend_mrs_meerkat_v1','burrow-v1-placeholder','Mrs Meerkat','Watcher of bright horizons','common','{"renderer":"bundled","key":"Mrs Meerkat"}',array['hope','friendship'],false),
  ('friend_mrs_owl_v1','burrow-v1-placeholder','Mrs Owl','Keeper of evening stories','common','{"renderer":"bundled","key":"Mrs Owl"}',array['story','reflection'],false)
on conflict (stable_id) do update set
  name=excluded.name,subtitle=excluded.subtitle,art=excluded.art,
  tags=excluded.tags,is_placeholder=false,updated_at=now();

-- Each encounter has a complete, answerable prompt and a gentle insight.
with stories(friend_id,prompt,a,b,c,fa,fb,fc,insight) as (values
  ('friend_miss_armadillo_v1','What makes a difficult day feel softer?',
    'A familiar place','A kind message','A little quiet',
    'Familiar places can help us exhale.','A few kind words can travel a long way.','Quiet can be a gift, too.',
    'Comfort does not have to be grand to be real.'),
  ('friend_miss_frog_v1','Where would you pause for a moment today?',
    'Beside the water','Under a tree','At home',
    'Water has a way of slowing the day down.','A little shade can make room to think.','Home can be a small, safe pause.',
    'Even a short pause belongs in the story of your day.'),
  ('friend_mr_badger_v1','What would help you take one brave step?',
    'A plan','A hand to hold','A deep breath',
    'A small plan is still a beginning.','You do not have to be brave alone.','One breath is enough for the next step.',
    'Courage often looks like beginning before you feel ready.'),
  ('friend_mr_hedgehog_v1','How do you recharge after giving so much?',
    'Say no to one thing','Ask for help','Rest without a reason',
    'A gentle no can protect what matters.','Letting someone help is a kind of trust.','Rest does not need to be earned.',
    'A boundary can make more room for closeness.'),
  ('friend_mr_pocket_gopher_v1','Which tiny treasure would you keep from today?',
    'A laugh','A kind word','A peaceful minute',
    'That laugh can stay with you.','Kind words are worth collecting.','A peaceful minute counts as a treasure.',
    'The smallest things often fit best in our pockets.'),
  ('friend_mr_prairie_dog_v1','What would you tell your person about today?',
    'The best part','The hard part','One surprising thing',
    'Joy feels lovely when it is shared.','The hard part deserves a listener, too.','Surprises make good stories.',
    'You do not need a perfect story to reach out.'),
  ('friend_mr_wombat_v1','What makes a place feel like yours?',
    'A warm light','Someone waiting','A favorite little thing',
    'A warm light can welcome you back.','Belonging often begins with someone waiting.','Little familiar things can anchor us.',
    'A cozy place is built one caring detail at a time.'),
  ('friend_mrs_aardvark_v1','Which path would you explore together?',
    'A new café','A winding trail','A quiet bookstore',
    'A new table can hold a new memory.','A slow walk leaves room to talk.','A bookstore is full of possible worlds.',
    'Curiosity is more fun when someone walks beside you.'),
  ('friend_mrs_meerkat_v1','What bright thing are you looking forward to?',
    'Seeing someone','Trying something new','A day of rest',
    'Anticipation can make a reunion warmer.','A small first try is plenty.','Rest is something to look forward to.',
    'Hope can be as simple as making a little room for tomorrow.'),
  ('friend_mrs_owl_v1','Which part of tonight would you remember?',
    'A conversation','A quiet feeling','The sky outside',
    'Some conversations glow long after they end.','A quiet feeling can tell its own story.','The evening sky changes every day.',
    'The day is worth remembering, even when nothing dramatic happened.')
)
insert into public.friend_content
  (friend_id,content_type,prompt,choices,feedback,locale,position,is_placeholder,trigger_scene)
select friend_id,'question',prompt,
  jsonb_build_array(jsonb_build_object('id','a','label',a),
                    jsonb_build_object('id','b','label',b),
                    jsonb_build_object('id','c','label',c)),
  jsonb_build_object('a',fa,'b',fb,'c',fc),'en',1,false,'both'
from stories
union all
select friend_id,'insight',insight,'[]'::jsonb,'{}'::jsonb,'en',2,false,'both'
from stories;
