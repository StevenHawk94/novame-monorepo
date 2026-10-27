-- Refresh 36 supplied originals; preserve prices, Plus settings, receipts and history.
begin;
select pg_advisory_xact_lock(hashtextextended('burrow-shop-prices',0));
do $$ begin
 if not exists(select 1 from public.content_revisions where id=(select value from public.app_config where key='app_major_update_content_revision') and status='published') then raise exception 'No published live revision'; end if;
end $$;
alter table public.burrow_surprises drop constraint burrow_surprises_frame_check;
alter table public.burrow_surprises add constraint burrow_surprises_frame_check check(frame in('santa','bunny','flower','heart','birthday','star','halloween','valentine','new_year','easter','good_morning','good_night','sweet_dreams','kiss_you','cuddle_time','thank_you','movie_night','dinner_date','spicy_mood','you_got_this','proud_of_you','feel_better','welcome_home','pumpkin','ghost','witch_cauldron','bat','christmas_ornament','snow_globe','christmas_elf','christmas_stocking','christmas_wreath','snowman','gingerbread_man','champagne','nightcap','alarm_clock','four_leaf_clover','ice_cream','coffee_mug','gold_trophy','popcorn','pizza','game_controller','autumn_pumpkin','lollipop','love_polaroid','fried_egg','birthday_cake','wrapped_gift','party_hat','birthday_balloons','olive_branch','white_flag','rainbow'));
insert into public.catalog_items(stable_id,revision_id,item_type,category,title,description,price,plus_only,tradable,drop_weight,asset,metadata,is_placeholder,status)
select id,(select value from public.app_config where key='app_major_update_content_revision'),'surprise','surprises',title,'Pay per send. Preview and replay are free.',300,false,false,0,'{"renderer":"bundled"}'::jsonb,metadata,false,'active'
from (values
('surprise:pumpkin','Pumpkin','{"frameId":"pumpkin","artOrdinal":1,"sourceFile":"01_Pumpkin.webp","billing":"per_send"}'::jsonb),
('surprise:santa','Santa Claus','{"frameId":"santa","artOrdinal":2,"sourceFile":"01_Santa_Claus.webp","billing":"per_send"}'::jsonb),
('surprise:birthday','Birthday Cake','{"frameId":"birthday","artOrdinal":3,"sourceFile":"02_Birthday_Cake.webp","billing":"per_send"}'::jsonb),
('surprise:ghost','Ghost','{"frameId":"ghost","artOrdinal":4,"sourceFile":"02_Ghost.webp","billing":"per_send"}'::jsonb),
('surprise:good_night','Goodnight Cap','{"frameId":"good_night","artOrdinal":5,"sourceFile":"03_Goodnight_Cap.webp","billing":"per_send"}'::jsonb),
('surprise:witch_cauldron','Witch Cauldron','{"frameId":"witch_cauldron","artOrdinal":6,"sourceFile":"03_Witch_Cauldron.webp","billing":"per_send"}'::jsonb),
('surprise:bat','Bat','{"frameId":"bat","artOrdinal":7,"sourceFile":"04_Bat.webp","billing":"per_send"}'::jsonb),
('surprise:spicy_mood','Spicy Devil','{"frameId":"spicy_mood","artOrdinal":8,"sourceFile":"04_Spicy_Devil.webp","billing":"per_send"}'::jsonb),
('surprise:christmas_ornament','Christmas Ornament','{"frameId":"christmas_ornament","artOrdinal":9,"sourceFile":"05_Christmas_Ornament.webp","billing":"per_send"}'::jsonb),
('surprise:snow_globe','Snow Globe','{"frameId":"snow_globe","artOrdinal":10,"sourceFile":"06_Snow_Globe.webp","billing":"per_send"}'::jsonb),
('surprise:christmas_elf','Christmas Elf','{"frameId":"christmas_elf","artOrdinal":11,"sourceFile":"07_Christmas_Elf.webp","billing":"per_send"}'::jsonb),
('surprise:christmas_stocking','Christmas Stocking','{"frameId":"christmas_stocking","artOrdinal":12,"sourceFile":"08_Christmas_Stocking.webp","billing":"per_send"}'::jsonb),
('surprise:christmas_wreath','Christmas Wreath','{"frameId":"christmas_wreath","artOrdinal":13,"sourceFile":"09_Christmas_Wreath.webp","billing":"per_send"}'::jsonb),
('surprise:snowman','Snowman','{"frameId":"snowman","artOrdinal":14,"sourceFile":"11_Snowman.webp","billing":"per_send"}'::jsonb),
('surprise:gingerbread_man','Gingerbread Man','{"frameId":"gingerbread_man","artOrdinal":15,"sourceFile":"12_Gingerbread_Man.webp","billing":"per_send"}'::jsonb),
('surprise:champagne','Champagne','{"frameId":"champagne","artOrdinal":16,"sourceFile":"16_Champagne.webp","billing":"per_send"}'::jsonb),
('surprise:nightcap','Nightcap','{"frameId":"nightcap","artOrdinal":17,"sourceFile":"18_Nightcap.webp","billing":"per_send"}'::jsonb),
('surprise:alarm_clock','Alarm Clock','{"frameId":"alarm_clock","artOrdinal":18,"sourceFile":"20_Alarm_Clock.webp","billing":"per_send"}'::jsonb),
('surprise:four_leaf_clover','Four Leaf Clover','{"frameId":"four_leaf_clover","artOrdinal":19,"sourceFile":"21_Four_Leaf_Clover.webp","billing":"per_send"}'::jsonb),
('surprise:heart','Sweet Heart','{"frameId":"heart","artOrdinal":20,"sourceFile":"22_Sweet_Heart.webp","billing":"per_send"}'::jsonb),
('surprise:ice_cream','Ice Cream','{"frameId":"ice_cream","artOrdinal":21,"sourceFile":"26_Ice_Cream.webp","billing":"per_send"}'::jsonb),
('surprise:coffee_mug','Coffee Mug','{"frameId":"coffee_mug","artOrdinal":22,"sourceFile":"27_Coffee_Mug.webp","billing":"per_send"}'::jsonb),
('surprise:gold_trophy','Gold Trophy','{"frameId":"gold_trophy","artOrdinal":23,"sourceFile":"28_Gold_Trophy.webp","billing":"per_send"}'::jsonb),
('surprise:easter','Easter Egg','{"frameId":"easter","artOrdinal":24,"sourceFile":"29_Easter_Egg.webp","billing":"per_send"}'::jsonb),
('surprise:popcorn','Popcorn','{"frameId":"popcorn","artOrdinal":25,"sourceFile":"30_Popcorn.webp","billing":"per_send"}'::jsonb),
('surprise:pizza','Pizza','{"frameId":"pizza","artOrdinal":26,"sourceFile":"31_Pizza.webp","billing":"per_send"}'::jsonb),
('surprise:game_controller','Game Controller','{"frameId":"game_controller","artOrdinal":27,"sourceFile":"32_Game_Controller.webp","billing":"per_send"}'::jsonb),
('surprise:lollipop','Lollipop','{"frameId":"lollipop","artOrdinal":28,"sourceFile":"34_Lollipop.webp","billing":"per_send"}'::jsonb),
('surprise:love_polaroid','Love Polaroid','{"frameId":"love_polaroid","artOrdinal":29,"sourceFile":"35_Love_Polaroid.webp","billing":"per_send"}'::jsonb),
('surprise:fried_egg','Fried Egg','{"frameId":"fried_egg","artOrdinal":30,"sourceFile":"36_Fried_Egg.webp","billing":"per_send"}'::jsonb),
('surprise:wrapped_gift','Wrapped Gift','{"frameId":"wrapped_gift","artOrdinal":31,"sourceFile":"38_Wrapped_Gift.webp","billing":"per_send"}'::jsonb),
('surprise:party_hat','Party Hat','{"frameId":"party_hat","artOrdinal":32,"sourceFile":"39_Party_Hat.webp","billing":"per_send"}'::jsonb),
('surprise:birthday_balloons','Birthday Balloons','{"frameId":"birthday_balloons","artOrdinal":33,"sourceFile":"40_Birthday_Balloons.webp","billing":"per_send"}'::jsonb),
('surprise:olive_branch','Olive Branch','{"frameId":"olive_branch","artOrdinal":34,"sourceFile":"41_Olive_Branch.webp","billing":"per_send"}'::jsonb),
('surprise:white_flag','White Flag','{"frameId":"white_flag","artOrdinal":35,"sourceFile":"42_White_Flag.webp","billing":"per_send"}'::jsonb),
('surprise:rainbow','Rainbow','{"frameId":"rainbow","artOrdinal":36,"sourceFile":"51_Rainbow.webp","billing":"per_send"}'::jsonb)
) seed(id,title,metadata)
on conflict(stable_id) do update set title=excluded.title,metadata=catalog_items.metadata||excluded.metadata,asset=excluded.asset,updated_at=now();
-- Retire missing styles, never delete sent messages or change billing/Plus edits.
update public.catalog_items set status='retired',updated_at=now() where item_type='surprise' and category='surprises' and status='active' and stable_id not in('surprise:pumpkin','surprise:santa','surprise:birthday','surprise:ghost','surprise:good_night','surprise:witch_cauldron','surprise:bat','surprise:spicy_mood','surprise:christmas_ornament','surprise:snow_globe','surprise:christmas_elf','surprise:christmas_stocking','surprise:christmas_wreath','surprise:snowman','surprise:gingerbread_man','surprise:champagne','surprise:nightcap','surprise:alarm_clock','surprise:four_leaf_clover','surprise:heart','surprise:ice_cream','surprise:coffee_mug','surprise:gold_trophy','surprise:easter','surprise:popcorn','surprise:pizza','surprise:game_controller','surprise:lollipop','surprise:love_polaroid','surprise:fried_egg','surprise:wrapped_gift','surprise:party_hat','surprise:birthday_balloons','surprise:olive_branch','surprise:white_flag','surprise:rainbow');
notify pgrst,'reload schema';
commit;
