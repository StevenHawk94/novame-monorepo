const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const model=load('apps/mobile/src/lib/cooperative-adventure.ts');
const identityModel=load('apps/mobile/src/lib/bunny-identity-model.ts');
const stamp=n=>new Date(n).toISOString(),H=3600000,start=Date.parse('2026-10-25T00:00:00Z');
test('character bootstrap supplement is capability gated and rejects stale relationship metadata',async()=>{
 const api=load('apps/api/src/lib/bunny-adventure-contract.mjs');let calls=0;
 const identity={userId:'a',partnerId:'b',pairVersion:'v'},db={rpc:async()=>{calls++;return{data:{identity,adventure:{userId:'a'}}};}};
 const snapshot={partner:{id:'b'},pairVersion:'v'},request=values=>({headers:{get:key=>values[key]}});
 assert.equal(await api.readCharacterState(db,'a',snapshot,request({})),null);assert.equal(calls,0);
 const r=await api.readCharacterState(db,'a',snapshot,request({'x-burrow-bunny':'1'}));assert.deepEqual(r.bunnyIdentity,identity);assert.equal(r.adventureTeam,undefined);
 assert.equal(await api.readCharacterState(db,'a',{...snapshot,pairVersion:'new'},request({'x-burrow-adventure':'5'})),null);
});
test('API start v5 and Nudge use authenticated actor, explicit capability and no legacy fallback',async()=>{
 const id='11111111-1111-4111-8111-111111111111',partner='22222222-2222-4222-8222-222222222222';
 let owner=id,result={error:'not_paired'};const calls=[];
 const common={
  'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
  '@/lib/app-major-update':{authenticatedUserId:async()=>owner,appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:result};}}),majorUpdateEnabled:async()=>true,commandStatus:e=>e?409:200},
  '@/lib/adventure-bootstrap.mjs':{readAdventureDisplay:async()=>null},'@/lib/burrow-reward-wallet.mjs':{withRewardWallet:async(_db,_user,data)=>data},
 };
 const route=load('apps/api/src/app/api/vnext/command/route.js',common);
 const req=(body,cap=true)=>({headers:{get:key=>key==='x-burrow-adventure'&&cap?'5':null},text:async()=>JSON.stringify(body)});
 const body={action:'start_adventure',recordId:id,idempotencyKey:'immutable',encounterVersion:5,catalogRelease:'release',partnerId:partner,pairVersion:'a'.repeat(32),userId:partner};
 assert.equal((await route.POST(req(body,false))).status,400);assert.equal(calls.length,0);
 assert.equal((await route.POST(req(body))).body.error,'not_paired');assert.equal(calls.length,1);assert.equal(calls[0].name,'start_adventure_v5');assert.equal(calls[0].args.p_user_id,id);
 result={alreadySent:false};await route.POST(req({action:'nudge_adventure',partyId:partner,idempotencyKey:id}));assert.equal(calls.at(-1).name,'nudge_adventure_v1');assert.equal(calls.at(-1).args.p_user,id);
 owner=null;assert.equal((await route.POST(req(body))).status,401);assert.equal(calls.length,2);
});
test('Nudge durable worker retries the original intent, isolates relationship and old-account replies',async()=>{
 const values=new Map(),events=[],requests=[];let user='a',epoch=1,seq=0,online=false;
 let data={profile:{id:'a'},partner:{id:'b'},pairVersion:'v'};
 const state={currentState:'active'},api={post:async(url,body)=>{requests.push(body);if(!online)throw Error('offline');return{};}};
 const actual=load('apps/mobile/src/lib/adventure-nudge.ts',{
  react:hooks().react,'react-native':{AppState:state},'expo-crypto':{randomUUID:()=> 'id-'+ ++seq},'./api':{apiClient:api},
  './storage':{storage:{getString:key=>values.get(key),set:(key,value)=>values.set(key,value)}},
  '../shared/storage/keys':{kAdventureNudges:{name:'nudges'}},
  './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>user,subscribeSessionIdentity:fn=>events.push(fn)},
  './burrow-store':{getBurrowSnapshot:()=>({data})},
 });
 actual.queueAdventureNudge('party');await actual.resumeAdventureNudges();actual.pauseAdventureNudges();
 const saved=JSON.parse(values.get('nudges'))[0];assert.equal(saved.state,'queued');
 actual.queueAdventureNudge('party');assert.equal(JSON.parse(values.get('nudges')).length,1);
 online=true;await actual.resumeAdventureNudges();assert.equal(requests.at(-1).idempotencyKey,saved.key);
 assert.equal(JSON.parse(values.get('nudges'))[0].state,'sent');
 const response=deferred();api.post=async()=>response.promise;actual.queueAdventureNudge('second');
 user='c';epoch++;events.forEach(fn=>fn());data={profile:{id:'c'},partner:{id:'d'},pairVersion:'new'};
 response.resolve({});await flush();assert.equal(JSON.parse(values.get('nudges')).find(j=>j.party==='second').state,'queued','late reply must not settle a different session');
 actual.pauseAdventureNudges();
});
const team=patch=>({id:'party',version:1,ruleVersion:5,leaderId:'a',followerId:null,partnerId:'b',pairVersion:'pair',plus:false,
 startedAt:stamp(start),progressAt:stamp(start),progressFraction:0,endsAt:stamp(start+6*H),nudged:false,leaderVariant:'biscuit',followerVariant:'pinky',...patch});
test('four states have truthful multipliers, status-only couple labels, Plus solo 2x not 1.5x',()=>{
 const expected=[[false,false,'Nudge Sam','1.5x'],[true,false,'Nudge Sam','2x'],[false,true,'You’re in Couple Mode','1.5x'],[true,true,'You’re in Plus+Couple Mode','3x']];
 for(const [plus,couple,label,copy]of expected){const v=model.adventureModeCopy(plus,couple,'Sam');assert.equal(v.label,label);assert.ok(v.copy.includes(copy));}
 assert.equal(load('apps/mobile/src/lib/adventure-duration.ts').adventureDurationMs(true),3*H);
 const ui=fs.readFileSync('apps/mobile/src/components/burrow/adventure-progress-screen.tsx','utf8');
 assert.match(ui,/plus:\{position:'absolute'/,'Plus badge cannot stretch across and cover the title');
 assert.match(ui,/couple\?<View[^]*?fontSize:Math.max\(18,23\*scale\)/,'status label keeps the button typography');
});
test('remaining-only acceleration preserves progress and clock/animation lifetime, immediate truthful shorter countdown',()=>{
 const clock=load('apps/mobile/src/lib/adventure-presentation-clock.ts').createAdventurePresentationClock();
 const input={identity:'a:b:pair',adventureId:'mine',pending:false,startedAt:stamp(start),endsAt:stamp(start+6*H),now:start+2*H,clockNow:2*H,team:team()};
 const before=clock.read(input);assert.equal(before.progress,1/3);assert.equal(before.remaining,4*H);
 const nextTeam=team({version:2,followerId:'b',progressAt:stamp(start+2*H),progressFraction:1/3,endsAt:stamp(start+2*H+4*H/1.5)});
 const after=clock.read({...input,endsAt:nextTeam.endsAt,team:nextTeam});assert.equal(after.progress,before.progress);
 assert.equal(after.remaining,4*H/1.5);assert.equal(after.lifetime,before.lifetime);assert.notEqual(after.timeline,before.timeline);
 const minute=clock.read({...input,endsAt:nextTeam.endsAt,team:nextTeam,now:input.now+60000,clockNow:input.clockNow+60000});
 assert.ok(minute.progress>after.progress);assert.equal(minute.timeline,after.timeline);
 assert.equal(model.teamProgress(nextTeam,Date.parse(nextTeam.endsAt)),1);
});
test('prepared team is bound to exact user, current relationship and personal Adventure ID',()=>{
 const data={profile:{id:'a'},partner:{id:'b'},pairVersion:'pair',activeAdventure:{id:'mine'},adventureTeam:{userId:'a',partnerId:'b',pairVersion:'pair',adventureId:'mine',team:team()}};
 assert.equal(model.teamStateFor(data),data.adventureTeam);
 for(const patch of [{profile:{id:'x'}},{partner:{id:'c'}},{pairVersion:'new'},{activeAdventure:{id:'other'}}])assert.equal(model.teamStateFor({...data,...patch}),null);
});
test('leader begins clear of shovel; follower is arc-distance behind through both turns, same path and one phase',()=>{
 const p=load('apps/mobile/src/lib/adventure-digging-path.ts');
 assert.ok(p.diggingPathPoint(p.diggingCursorFraction(0)).x-37>=112);
 for(let i=0;i<=100;i++){
  const front=p.diggingCursorFraction(i/100),back=p.diggingCursorFraction(i/100,true);assert.ok(front>=back);
  assert.ok(Math.abs((front-back)*p.DIGGING_PATH_LENGTH-48)<1e-8,'close following with slight transparent-image overlap');
 }
 const source=fs.readFileSync('apps/mobile/src/components/burrow/adventure-digging-route.tsx','utf8');
 assert.doesNotMatch(source,/setInterval|setTimeout|runOnJS|getPointAtLength|measure\(/);
 assert.equal((source.match(/useSharedValue\(0\)/g)||[]).length,1,'one shared decorative phase, no follower clock');
});
function identityHarness(){
 const values=new Map(),requests=[],events=[];let owner='a',epoch=1,uuid=0;
 const h=hooks(),api={post:async(_url,body)=>{requests.push(body);return {userId:owner,variant:body.variant,revision:1,finalized:false,partnerId:null,partnerVariant:null,pairVersion:null};},get:async()=>({userId:owner,variant:'biscuit',revision:1,finalized:false,partnerId:null,partnerVariant:null,pairVersion:null})};
 const actual=load('apps/mobile/src/lib/bunny-identity.ts',{
  react:h.react,'expo-crypto':{randomUUID:()=> 'uuid-'+ ++uuid},'./api':{apiClient:api},
  './storage':{storage:{getString:key=>values.get(key),set:(key,value)=>values.set(key,value)}},
  '../shared/storage/keys':{kBunnyIdentity:{name:'identity'}},'./bunny-identity-model':identityModel,
  './session-lifecycle':{sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>events.push(fn)},
 });return {...actual,values,requests,api,change(value){owner=value;epoch++;events.forEach(fn=>fn());}};
}
test('role assignment signal is staged; only next Home atomically adopts a PREPARED full suite',async()=>{
 const h=identityHarness();h.queueBunnySelection('biscuit');const key=JSON.parse(h.values.get('identity')).intent.key;
 h.queueBunnySelection('biscuit');assert.equal(JSON.parse(h.values.get('identity')).intent.key,key);
 h.observeBunnyIdentity({userId:'a',variant:'pinky',revision:2,finalized:true,partnerId:'b',partnerVariant:'biscuit',pairVersion:'pair'});
 assert.equal(h.bunnyVariant(),'biscuit','incoming signal cannot change a visible rabbit');
 const ready=deferred();let current=true;const adopting=h.adoptBunnyOnHome(()=>ready.promise,()=>current);
 assert.equal(h.bunnyVariant(),'biscuit');current=false;ready.resolve();await adopting;assert.equal(h.bunnyVariant(),'biscuit');
 await h.adoptBunnyOnHome(async colour=>assert.equal(colour,'pinky'),()=>true);assert.equal(h.bunnyVariant(),'pinky');
 h.queueBunnySelection('biscuit');assert.equal(h.bunnyVariant(),'pinky','finalized identity cannot be changed by another local pick');
 h.change('c');assert.equal(h.bunnyVariant(),'biscuit','account-scoped colour must not leak');
});
test('stale identity and lower revisions cannot overwrite a fixed current identity',()=>{
 const h=identityHarness();const mine={userId:'a',variant:'pinky',revision:3,finalized:true,partnerId:null,partnerVariant:null,pairVersion:null};
 h.observeBunnyIdentity(mine);h.observeBunnyIdentity({...mine,revision:2,variant:'biscuit'});
 h.observeBunnyIdentity({...mine,userId:'other',revision:9,variant:'biscuit'});
 assert.equal(h.knownBunnyIdentity().revision,3);assert.equal(h.bunnyVariant(),'pinky');
});
test('room actor forwards explicit owner; partner art resolves partner colour, never the viewer colour',()=>{
 const h=identityHarness();h.observeBunnyIdentity({userId:'a',variant:'biscuit',revision:1,finalized:true,partnerId:'b',partnerVariant:'pinky',pairVersion:'pair'});
 assert.equal(h.bunnyVariant('a'),'biscuit');assert.equal(h.bunnyVariant('b'),'pinky');assert.equal(h.bunnyVariant('third-party'),'biscuit');
 const state=hooks(),jsx=(type,props)=>({type,props});
 const actor=load('apps/mobile/src/components/burrow/bunny-actor.tsx',{
  react:state.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',StyleSheet:{create:s=>s}},'./outfit-bunny':{OutfitBunny:'Outfit'},
 });
 const tree=state.render(()=>actor.BunnyActor({ownerId:'b',partner:true}));assert.equal(tree.props.children.props.ownerId,'b');state.unmount();
 const scene=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');assert.match(scene,/ownerId=\{section==='our_room'\?data.profile.id:owner\?\?data.profile.id\}/);
});
test('all 19 outfits share original ears/tail and permanent IDs; exactly static head/body variants plus baked card images',()=>{
 const catalog=JSON.parse(fs.readFileSync('catalog/burrow-shop-products.json')),outfits=catalog.products.filter(p=>p.type==='outfit');assert.equal(outfits.length,19);
 for(const p of outfits){
  assert.deepEqual(Object.keys(p.bunnyVariants.pinky).sort(),['body','head']);
  for(const file of [...Object.values(p.layers),...Object.values(p.bunnyVariants.pinky),...Object.values(p.bunnyThumbnails)])assert.ok(fs.existsSync('apps/mobile/assets/'+file),file);
  assert.ok(!p.layers.earLeft.includes('pink'));assert.ok(!p.layers.tail.includes('pink'));assert.ok(p.asset.outfitKey);
 }
 const source=fs.readFileSync('apps/mobile/src/components/burrow/outfit-thumbnail.tsx','utf8');assert.doesNotMatch(source,/prepareBunny\(|from ['"]@shopify|useFrameCallback\(/);
 const cache=fs.readFileSync('apps/mobile/src/lib/prepared-bunny.ts','utf8');assert.match(cache,/\$\{key\}:\$\{variant\}:ef9ba3-v2/);assert.match(cache,/ready.size > 2/);
});
test('new role page appears after date and before pairing; code-enterer copy, only remaining choice when partner known',()=>{
 const design=load('apps/mobile/src/lib/burrow-onboarding-design.ts',Object.fromEntries([...fs.readFileSync('apps/mobile/src/lib/burrow-onboarding-design.ts','utf8').matchAll(/require\('([^']+)'\)/g)].map(([,p])=>[p,p])));
 const i=design.ONBOARDING_FLOW.indexOf('choose-bunny');assert.equal(design.ONBOARDING_FLOW[i-1],'relationship-date');assert.equal(design.ONBOARDING_FLOW[i+1],'pairing');
 const h=hooks(),jsx=(type,props)=>({type,props}),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
 let identity;const changes=[];
 const {ChooseBunnyPage}=load('apps/mobile/src/components/onboarding/choose-bunny-page.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Pressable:'Choice',View:'View',Text:'Text',StyleSheet:{create:s=>s}},'expo-image':{Image:'Image'},
  '@/lib/app-viewport':{useAppViewport:()=>({width:390,height:844})},'@/lib/bunny-variant-assets':{BUNNY_ICONS:{biscuit:1,pinky:2}},'@/lib/bunny-identity':{useBunnyIdentity:()=>identity},
 });
 const render=()=>nodes(h.render(()=>ChooseBunnyPage({value:'biscuit',onChange:value=>changes.push(value)})));
 assert.equal(render().filter(n=>n.type==='Choice').length,2);
 identity={partnerId:'b',partnerVariant:'biscuit',finalized:false};const tree=render();assert.equal(tree.filter(n=>n.type==='Choice').length,1);
 assert.equal(tree.find(n=>n.type==='Choice').props.accessibilityLabel,'Pinky');assert.equal(changes.at(-1),'pinky');
 assert.ok(tree.some(n=>n.type==='Text'&&String(n.props.children).includes('whoever enters the invite code keeps it')));h.unmount();
});
