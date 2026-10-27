-- Apply only after the V2 API is Ready and the immutable R2 manifest is verified.
do $$ begin
  if (select count(*) from adventure_dialogues_v2 where status='active')<>450
    or (select count(*) from catalog_items where status='active' and 'adventure_v2_gift'=any(tags))<>483
    or (select count(*) from friend_definitions where status='active' and metadata->>'adventureV2'='true')<>15
    then raise exception 'Adventure V2 release manifest incomplete'; end if;
end $$;
update app_config set value='true',updated_at=now() where key='adventure_friends_v2_enabled';
notify pgrst,'reload schema';
