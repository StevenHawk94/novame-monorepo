const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,flush,deferred}=require('./lifecycle-test-utils.cjs');
const {presentationImports}=require('./motion-test-utils.cjs');
const model=load('apps/mobile/src/lib/cooperative-adventure.ts');
const now=Date.parse('2026-10-29T12:00:00Z'),iso=n=>new Date(n).toISOString();
const team={id:'party',version:1,ruleVersion:5,leaderId:'me',followerId:null,partnerId:'partner',pairVersion:'v',plus:false,
 startedAt:iso(now-3600000),progressAt:iso(now-3600000),progressFraction:0,endsAt:iso(now+3600000),nudged:false,leaderVariant:'biscuit',followerVariant:'pinky'};
const state=patch=>({userId:'me',partnerId:'partner',pairVersion:'v',adventureId:'trip',team,joinable:null,nudgeAvailable:true,nudgeStatus:{reason:'available'},...patch});
const present=patch=>model.adventureOngoingPresentation({state:state(),paired:true,name:'Alex',hasPlus:false,pending:false,remaining:3600000,now,nudge:'idle',...patch});
test('all four applied-speed states keep multipliers; current membership alone controls upsell and badge',()=>{
 for(const [plus,couple] of [[false,false],[true,false],[false,true],[true,true]]){
  const p=present({state:state({team:{...team,plus,followerId:couple?'partner':null}}),hasPlus:plus});
  assert.ok(p.copy.includes(plus?(couple?'3x':'2x'):(couple?'1.5x':'2x')));
  assert.equal(p.couple,couple);assert.equal(p.canNudge,!couple);
 }
 const upgrading=present({hasPlus:true});assert.match(upgrading.copy,/boost is syncing/);assert.doesNotMatch(upgrading.copy,/Join Plus/);
 const expired=present({state:state({team:{...team,plus:true}})});assert.match(expired.copy,/2x/);assert.doesNotMatch(expired.copy,/Join Plus/);
});
test('finishing versus truly finished; two independently running Solos are not mislabeled finished or merged',()=>{
 for(const [reason,expected] of [['partner_finishing',"Alex is finishing today's adventure."],['partner_finished',"Alex has already finished today's adventure."],['partner_adventuring','Alex is on another adventure.']]){
  const p=present({state:state({nudgeAvailable:false,nudgeStatus:{reason}})});
  assert.equal(p.label,'Solo Adventure');assert.ok(p.copy.endsWith(expected));assert.equal(p.canNudge,false);
 }
 const snapshot=state({nudgeAvailable:false,nudgeStatus:{reason:'partner_adventuring',partnerEndsAt:iso(now+601000),partnerUsedToday:true}});
 assert.match(present({state:snapshot,now:now+1000}).copy,/is finishing/);
 assert.match(present({state:snapshot,now:now+601000}).copy,/has already finished/);
 snapshot.nudgeStatus.partnerUsedToday=false;
 assert.doesNotMatch(present({state:snapshot,now:now+601000}).copy,/finished today's/,'an old-day due trip does not consume today');
 assert.equal(present({state:snapshot,now:now+601000}).canNudge,false,'client clock never invents permission');
});
test('unknown/pending receipt keeps confirmed partner, never enables an invented invitation; restrictions reveal no fake reason',()=>{
 for(const patch of [{state:null},{pending:true},{state:state({coordinationPending:true,nudgeAvailable:false})}]){
  const p=present(patch);assert.equal(p.label,'Nudge Alex');assert.match(p.copy,/Checking adventure availability/);assert.equal(p.canNudge,false);
 }
 for(const reason of ['economy_restricted','relationship_unavailable']){
  const p=present({state:state({nudgeAvailable:false,nudgeStatus:{reason}})});
  assert.equal(p.copy,'Join Plus to finish 2x faster.');assert.equal(p.label,'Solo Adventure');
 }
 const unpaired=present({paired:false});assert.match(unpaired.copy,/Connect with your partner to adventure together/);assert.doesNotMatch(unpaired.copy,/future adventure/);
});
test('submitted reminder, permanent refusal and inclusive local join cutoff use one consistent label/footer',()=>{
 for(const nudge of ['queued','sent']){
  const p=present({nudge});assert.equal(p.label,'Reminder submitted ✓');assert.match(p.copy,/You’ll team up when Alex joins/);assert.equal(p.canNudge,false);
  const closed=present({nudge,remaining:600000});assert.equal(closed.label,'Your bunny is almost back');assert.doesNotMatch(closed.copy,/team up|Nudge|Reminder submitted/);
  const finished=present({nudge,state:state({nudgeAvailable:false,nudgeStatus:{reason:'partner_finished'}})});assert.equal(finished.label,'Solo Adventure');assert.match(finished.copy,/has already finished/);
 }
 const blocked=present({nudge:'blocked'});assert.match(blocked.copy,/couldn’t submit/);assert.equal(blocked.canNudge,true);
});
const jsx=(type,props)=>({type,props}),nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
test('actual ongoing component renders the same derived button/copy, current Plus badge, disabled state and original route geometry',()=>{
 for(const reason of ['available','partner_finishing','partner_finished','economy_restricted','partner_adventuring'])for(const hasPlus of [false,true]){
  const h=hooks(),s=state({team:{...team,plus:true},nudgeAvailable:reason==='available',nudgeStatus:{reason}}),queue=[];
  const {AdventureProgressScreen}=load('apps/mobile/src/components/burrow/adventure-progress-screen.tsx',{
   ...presentationImports(h),react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
   'react-native':{View:'View',Text:'Text',StyleSheet:{create:x=>x,absoluteFillObject:{}}},
   '@/lib/app-viewport':{useAppViewport:()=>({width:320,height:568})},'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20,bottom:0})},
   '@/lib/adventure-journal-jobs':{useAdventureJournalJob:()=>undefined},'@/lib/burrow-store':{burrowClock:()=>0},
   '@/lib/adventure-screen-layout':load('apps/mobile/src/lib/adventure-screen-layout.ts'),
   './native-vertical-gradient':{NativeVerticalGradient:'Gradient'},
   './adventure-digging-route':{AdventureDiggingRoute:'Route'},'./burrow-back-button':{BurrowBackButton:'Back'},
   '@/lib/adventure-nudge':{useAdventureNudge:()=> 'idle',queueAdventureNudge:id=>queue.push(id)},
  });
  const data={profile:{id:'me'},partner:{id:'partner',display_name:'Alex'},pairVersion:'v',hasPlus,specialQuests:[],adventureTeam:s,
   activeAdventure:{id:'trip',started_at:team.startedAt,ends_at:team.endsAt}};
  const t=nodes(h.render(()=>AdventureProgressScreen({data,now,onHome(){}}))),expected=present({state:s,hasPlus});
  const button=t.find(n=>n.props?.accessibilityRole==='button'&&n.props?.children?.props?.children===expected.label);
  assert.ok(button);assert.equal(button.props.disabled,!expected.canNudge);assert.ok(t.some(n=>n.props?.children===expected.copy));
  assert.equal(t.some(n=>n.props?.children==='Plus'),hasPlus);assert.ok(t.find(n=>n.type==='Route').props.scale>0);
  if(expected.canNudge){button.props.onPress();assert.deepEqual(queue,['party']);}
  h.unmount();
 }
});
test('Nudge worker keeps same key after uncertainty; definitive refusal reports once; stale account replies cannot alert',async()=>{
 const disk=new Map(),alerts=[],identity=[],calls=[];let outcome='offline',epoch=1,user='me';
 const data={profile:{id:'me'},partner:{id:'partner'},pairVersion:'v'},reply=deferred();
 const imports={react:hooks().react,'react-native':{AppState:{currentState:'active'}},'expo-crypto':{randomUUID:()=> 'key-'+calls.length},
  './api':{apiClient:{post:async(_url,body)=>{calls.push(body);if(outcome==='offline')throw Error('offline');if(outcome==='wait')return reply.promise;throw {body:{error:'adventure_invite_unavailable'}};}}},
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},'../shared/storage/keys':{kAdventureNudges:{name:'jobs'}},
  './session-lifecycle':{sessionUserId:()=>user,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>identity.push(fn)},
  './burrow-store':{getBurrowSnapshot:()=>({data})},'./burrow-toast':{showBurrowToast:text=>alerts.push(text)},
 };
 const api=load('apps/mobile/src/lib/adventure-nudge.ts',imports);api.queueAdventureNudge('party');await api.resumeAdventureNudges();api.pauseAdventureNudges();
 const original=JSON.parse(disk.get('jobs'))[0];assert.equal(original.state,'queued');assert.equal(alerts.length,0);
 outcome='denied';await api.resumeAdventureNudges();assert.equal(calls.at(-1).idempotencyKey,original.key);assert.equal(JSON.parse(disk.get('jobs'))[0].state,'blocked');assert.equal(alerts.length,1);
 await api.resumeAdventureNudges();assert.equal(alerts.length,1);
 outcome='wait';api.queueAdventureNudge('another');user='other';epoch++;identity.forEach(fn=>fn());reply.reject({body:{error:'not_found'}});await flush();assert.equal(alerts.length,1);
 api.pauseAdventureNudges();
});
test('receipt-only optimistic projection cannot assert Nudge eligibility, and migration keeps every protected acquisition rule',()=>{
 const store=fs.readFileSync('apps/mobile/src/lib/burrow-store.ts','utf8');assert.equal((store.match(/nudgeAvailable:false,coordinationPending:true/g)||[]).length,2);
 const sql=fs.readFileSync('supabase/migrations/20261029000289_adventure_nudge_availability.sql','utf8');
 assert.match(sql,/burrow_pair_economy_allowed_v1/);assert.match(sql,/economic_timezone_v1\(partner\)/);assert.match(sql,/ends_at>now\(\)/);
 assert.doesNotMatch(sql,/update public\.|update adventures|update adventure_parties|create or replace function public\.start_adventure/);
});
