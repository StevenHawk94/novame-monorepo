const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load}=require('./lifecycle-test-utils.cjs');
const source=file=>fs.readFileSync(file,'utf8');
test('verified Plus timing immediately halves countdown without moving progress backwards or restarting the animation',()=>{
 const {createAdventurePresentationClock}=load('apps/mobile/src/lib/adventure-presentation-clock.ts');
 const now=Date.parse('2026-10-29T12:00:00Z'),H=3600000,iso=ms=>new Date(ms).toISOString();
 const team={id:'party',version:1,ruleVersion:5,leaderId:'me',partnerId:'partner',followerId:null,pairVersion:'v',plus:false,
  startedAt:iso(now-2*H),progressAt:iso(now-2*H),progressFraction:0,endsAt:iso(now+4*H)};
 for(const followerId of [null,'partner']){
  const clock=createAdventurePresentationClock();
  const input={identity:'me:partner:v',adventureId:'trip',pending:false,startedAt:team.startedAt,endsAt:team.endsAt,now,clockNow:10000,team:{...team,followerId}};
  const before=clock.read(input),upgraded={...input.team,version:2,plus:true,progressAt:iso(now),progressFraction:1/3,endsAt:iso(now+2*H)};
  const after=clock.read({...input,endsAt:upgraded.endsAt,team:upgraded});
  assert.equal(before.remaining,4*H);assert.equal(after.remaining,2*H);assert.equal(after.progress,before.progress);
  assert.equal(after.lifetime,before.lifetime);assert.notEqual(after.timeline,before.timeline);
  assert.equal(clock.read({...input,endsAt:upgraded.endsAt,team:upgraded}).timeline,after.timeline,'same receipt never restarts motion');
 }
});
test('currency prompts and accessibility use coins while actual feeding carrots and internal protocols remain intact',()=>{
 const files=['apps/mobile/src/lib/burrow-store.ts','apps/mobile/src/components/burrow/burrow-shop.tsx',
  'apps/mobile/src/components/burrow/toy-collection-screen.tsx','apps/mobile/src/components/burrow/burrow-screen.tsx',
  'apps/mobile/src/lib/carrot-iap.ts','apps/mobile/src/lib/iap.ts'];
 for(const file of files)assert.doesNotMatch(source(file),/enough carrots|No carrots were spent|Carrot Shop|\$\{item\.price\} carrots|Carrots will arrive|finish your carrot purchase/i,file);
 const store=source(files[0]);assert.match(store,/enough coins/);assert.match(store,/No coins were spent/);
 assert.match(source(files[2]),/\$\{item\.price\} coins/);
 assert.match(source('apps/mobile/src/components/burrow/garden-care-interaction.tsx'),/Hold to feed your bunny a carrot/);
 assert.match(source('apps/mobile/src/lib/carrot-iap.ts'),/purchaseCarrots/);
});
test('candidate keeps original reward snapshot and uses verified, service-only entitlement reconciliation',()=>{
 const sql=source('supabase/migrations/20261029000288_adventure_upgrade_and_owned_games.sql');
 assert.match(sql,/deadline:=accepted_at\+\(p\.ends_at-accepted_at\)\/2/);
 assert.match(sql,/p\.plus_snapshot or a\.status<>'in_progress'/);
 assert.match(sql,/refresh_economic_entitlements_before288_v1\(p_user\)/);
 assert.match(sql,/burrow_pair_economy_allowed_v1\(p_user_id,partner\)/);
 assert.doesNotMatch(sql,/set [^;]*\bplus_snapshot=true[^;]*where (?:id=a\.id|party_id=p\.id)/);
 assert.match(sql,/p_kind=''game''/);
 assert.doesNotMatch(sql,/update (?:public\.)?(?:wallets|user_inventory|catalog_items|adventure_encounter_plans)\b/i);
});
