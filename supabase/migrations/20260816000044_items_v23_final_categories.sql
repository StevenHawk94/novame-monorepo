-- v23 reclassifies the final seven stable v19 icons. The IDs, image order,
-- rarity, and display names are unchanged.
update public.items
set category = case id
  when 'memory.5385_social_media' then 'Entertainment & Leisure'
  when 'memory.5386_video' then 'Entertainment & Leisure'
  when 'memory.5387_music' then 'Entertainment & Leisure'
  when 'memory.5388_messaging' then 'Social & Relationships'
  when 'memory.5389_shopping' then 'Shopping & Errands'
  when 'memory.5390_food_delivery' then 'Food & Drink'
  when 'memory.5391_mobile_gaming' then 'Entertainment & Leisure'
  else category
end
where id in (
  'memory.5385_social_media',
  'memory.5386_video',
  'memory.5387_music',
  'memory.5388_messaging',
  'memory.5389_shopping',
  'memory.5390_food_delivery',
  'memory.5391_mobile_gaming'
);
