// Isolated character/loadout/privacy checks, never a live database.
export async function testCharacterState({ db, query, rpc, check }) {
  const me='00000000-0000-0000-0000-000000000006',partner='00000000-0000-0000-0000-000000000007';
  const record='20000000-0000-0000-0000-000000000006',outfit='placeholder_outfit_cozy_01';
  await db.exec('begin');
  await db.query('insert into profiles(id) values($1),($2)',[me,partner]);
  await db.query('insert into pairings values($1,$2),($2,$1)',[me,partner]);
  let state=await rpc('burrow_bootstrap_v1',[me]);
  await rpc('burrow_bootstrap_v1',[partner]);
  check(state.catalog.find(x=>x.stable_id===outfit)?.asset.outfitStyle==='jumper','replaceable outfit style available in catalog');
  check((await rpc('save_room_loadout_v1',[me,'home',{outfit}])).error==='item_not_owned','unowned clothing preview cannot persist');
  await rpc('change_carrot_balance_v1',[me,500,'fixture',null,null,'character-seed']);
  check((await rpc('purchase_catalog_item_v1',[me,me,outfit,'clothing-buy'])).balance===410,'clothing purchase charges server price');
  check((await rpc('save_room_loadout_v1',[me,'home',{outfit}])).applied===true,'Free user can wear purchased clothing');
  state=await rpc('burrow_bootstrap_v1',[partner]);
  check(state.loadouts.some(x=>x.owner_id===me&&x.slot==='outfit'&&x.item_id===outfit),'partner room reads the owner’s outfit');
  check((await rpc('save_room_loadout_v1',[partner,'home',{outfit}])).error==='item_not_owned','partner cannot equip clothing owned only by the other user');
  await db.query("update profiles set subscription_tier='plus' where id=$1",[me]);
  check((await rpc('save_room_loadout_v1',[me,'our',{outfit}])).error==='invalid_loadout','personal outfit cannot enter shared decor slots');
  await db.query("update room_needs set food_value=80,food_updated_at=now()-interval '10 minutes',water_value=0 where owner_id=$1",[me]);
  state=await rpc('burrow_bootstrap_v1',[me]);
  check(state.roomNeeds.food===78&&state.roomNeeds.foodValue===80,'bootstrap separates projected food from raw value');
  const other=await rpc('burrow_bootstrap_v1',[partner]);
  check(other.partnerNeeds.foodValue===80&&other.partnerNeeds.waterValue===0&&!!other.partnerNeeds.foodUpdatedAt,'partner receives raw needs and timestamps for local projection');
  await db.query("insert into reflects(id,user_id,journal_kind,body) values($1,$2,'write_freely','private diary')",[record,me]);
  await db.query('insert into reflect_drafts(user_id,finalized_reflect_id) values($1,$2)',[me,record]);
  const start=await rpc('start_adventure_v1',[me,record,'character-adventure']);
  state=await rpc('burrow_bootstrap_v1',[partner]);
  check(state.partnerAdventure?.id===start.adventureId,'partner receives away state for current pair');
  check(Object.keys(state.partnerAdventure).sort().join(',')==='ends_at,id,started_at,status','partner adventure excludes source record, tags, result, and request key');
  check(state.activeAdventure===null,'partner adventure cannot masquerade as own adventure');
  await db.query("update adventures set status='completed' where id=$1",[start.adventureId]);
  check((await rpc('burrow_bootstrap_v1',[partner])).partnerAdventure===null,'completed adventure no longer hides partner bunny');
  await db.exec('rollback');
}
