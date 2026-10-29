-- Approved pending copy cleanup and its exact client-capability registration.
-- No catalog republication, price/Plus change or reserved-result redraw.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('burrow-shop-publication',0));
create temporary table copy287_ids(product_id text primary key) on commit drop;
insert into copy287_ids values
 ('placeholder_couple_dolls_01'),('placeholder_couple_dolls_02'),
 ('placeholder_cushions_02'),('placeholder_frames_01'),('placeholder_frames_02'),
 ('placeholder_lamps_02'),('placeholder_music_players_01'),('placeholder_music_players_02'),
 ('placeholder_plants_02'),('placeholder_rugs_02'),('placeholder_storage_02'),('placeholder_tables_02');
do $$begin
 if (select count(*) from catalog_items c join copy287_ids i on c.stable_id=i.product_id)<>12
 or exists(select 1 from catalog_items c join copy287_ids i on c.stable_id=i.product_id
  where coalesce(c.description,'') not in('','Replaceable artwork. Fixed-slot room decoration.','Replaceable catalog content used to validate purchase, gifting and decoration.'))
 then raise exception 'Reviewed placeholder copy changed';end if;
 if (select count(*) from burrow_shop_release_support where release='d32938720e72d3b1ce81c5f667e4e81afb87a6798552183c72460b5ec3edc97c')<>496
 then raise exception 'Reviewed capability baseline missing';end if;
 if exists(select 1 from burrow_shop_release_support where release='5acf169b89ae03ad502a2f18797ae0e03b9aa59005e6e3104165845a63ff20f4') and (
  exists(select product_id from burrow_shop_release_support where release='5acf169b89ae03ad502a2f18797ae0e03b9aa59005e6e3104165845a63ff20f4' except select product_id from burrow_shop_release_support where release='d32938720e72d3b1ce81c5f667e4e81afb87a6798552183c72460b5ec3edc97c')
  or exists(select product_id from burrow_shop_release_support where release='d32938720e72d3b1ce81c5f667e4e81afb87a6798552183c72460b5ec3edc97c' except select product_id from burrow_shop_release_support where release='5acf169b89ae03ad502a2f18797ae0e03b9aa59005e6e3104165845a63ff20f4'))
 then raise exception 'Published client capabilities cannot change';end if;
end $$;
update public.catalog_items c set description='' from copy287_ids i where c.stable_id=i.product_id and c.description is distinct from '';
insert into public.burrow_shop_release_support(release,product_id)
 select '5acf169b89ae03ad502a2f18797ae0e03b9aa59005e6e3104165845a63ff20f4',product_id from burrow_shop_release_support
 where release='d32938720e72d3b1ce81c5f667e4e81afb87a6798552183c72460b5ec3edc97c' on conflict do nothing;
notify pgrst,'reload schema';
commit;
