const {presentationImports}=require('./motion-test-utils.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {load,hooks,deferred,flush}=require('./lifecycle-test-utils.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const at='2026-10-10T12:00:00Z';
function harness(){
  let owner='me';const disk=new Map(),listeners=[];
  const imports={react:{useSyncExternalStore(){}},'./storage':{storage:{getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value)}},
    // These legacy count/read-marker cases start AFTER the hydration boundary.
    // Real pre-ready behaviour is covered by test-notification-readiness.
    './notification-readiness':{notificationReadiness:{ready:()=>true,subscribe:()=>()=>{},revision:()=>0}},
    '../shared/storage/keys':{kBurrowAttention:{keyFor:key=>`attention:${key}`}},
    './session-lifecycle':{sessionUserId:()=>owner,subscribeSessionIdentity:fn=>listeners.push(fn)},
    './burrow-presentation':{adventureHasArrived:(a,now)=>!!a&&(['result_ready','interaction_required'].includes(a.status)||a.status==='in_progress'&&Date.parse(a.ends_at)<=now)},
    './burrow-moments-model':load('apps/mobile/src/lib/burrow-moments-model.ts')};
  const api=load('apps/mobile/src/lib/burrow-attention.ts',imports);
  return {api,disk,restart:()=>load('apps/mobile/src/lib/burrow-attention.ts',imports),change:value=>{owner=value;listeners.forEach(fn=>fn());}};
}
function snapshot(){
  return {profile:{id:'me'},partner:{id:'them'},pairAccessVerified:true,pairVersion:'v1',serverNow:at,localDate:'2026-10-10',affectionInbox:[{id:'a'},{id:'b'}],
    unread:{affection:2,gifts:0},moments:[{id:'one',actor_id:'them',event_type:'toy_interacted',payload:{count:1},created_at:at},
      {id:'self',actor_id:'me',event_type:'memory_created',payload:{},created_at:at},{id:'decoration',actor_id:'them',event_type:'room_decor_changed',payload:{},created_at:at}],
    memoryEntries:[{id:'letter',author_id:'them',body:'💌 Hello',updated_at:at}],friendVisit:{id:'visit',visit_date:'2026-10-10',completed_at:null,declined_at:null},
    quests:{quests:[{assignmentId:'q1',completedAt:at,claimedAt:null},{assignmentId:'q2',completedAt:at,claimedAt:at},{assignmentId:'q3',completedAt:null,claimedAt:null}]},
    specialQuests:[{questId:'games_played',stage:1,progress:10,target:10}],activeAdventure:{id:'journey',status:'result_ready',ends_at:at}};
}
test('badges show 1–9 / 9+; zero is hidden, not a dot or spinner',()=>{
  const h=harness();assert.equal(h.api.badgeLabel(0),null);assert.equal(h.api.badgeLabel(1),'1');assert.equal(h.api.badgeLabel(9),'9');assert.equal(h.api.badgeLabel(10),'9+');
  const jsx=(type,props)=>({type,props});
  const {UpdateBadge}=load('apps/mobile/src/components/burrow/update-badge.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',Text:'Text',StyleSheet:{create:v=>v}},'@/lib/burrow-attention':h.api});
  assert.equal(UpdateBadge({count:0}),null);assert.equal(UpdateBadge({count:11}).props.children.props.children,'9+');
  assert.equal(UpdateBadge({count:1,dot:true}).props.children,false);
});
test('counts include only pending claims and partner updates; opening Quests does not clear claims',()=>{
  const h=harness(),data=snapshot(),counts=h.api.burrowAttentionCounts(data);
  assert.equal(counts.tabs.quests,2);assert.equal(counts.tabs.friends,1);assert.equal(counts.letter,1);assert.equal(counts.affection,2);assert.equal(counts.adventure,1);
  assert.equal(counts.rooms.friends_room,1);assert.equal(counts.tabs.index,4);
  h.api.markBurrowUpdatesSeen(data,'moments');assert.equal(h.api.burrowAttentionCounts(data).tabs.friends,0);
  assert.equal(h.api.burrowAttentionCounts(data).tabs.quests,2);
});
test('letter unread IDs are scoped, deduplicated, and cleared only one opened revision at a time',()=>{
  const h=harness(),data=snapshot();
  data.memoryEntries.push({id:'second',author_id:'them',body:'💌 Another note',updated_at:at});
  assert.deepEqual(plain(h.api.unreadBurrowUpdateIds(data,'letters')),[`letter:${at}`,`second:${at}`]);
  h.api.markBurrowUpdatesSeen(data,'letters',[`letter:${at}`]);
  assert.deepEqual(plain(h.api.unreadBurrowUpdateIds(data,'letters')),[`second:${at}`]);
  assert.equal(h.api.burrowAttentionCounts(data).letter,1);
  const restarted=h.restart();assert.deepEqual(plain(restarted.unreadBurrowUpdateIds(data,'letters')),[`second:${at}`]);
  h.change('different-user');assert.deepEqual(plain(h.api.unreadBurrowUpdateIds(data,'letters')),[]);
});
test('seen IDs persist across restart; edits count again; different relationship/account is isolated',()=>{
  const h=harness(),data=snapshot();
  for(const channel of ['moments','letters','visits'])h.api.markBurrowUpdatesSeen(data,channel);
  const reboot=h.restart();assert.equal(reboot.burrowAttentionCounts(data).tabs.friends,0);assert.equal(reboot.burrowAttentionCounts(data).letter,0);
  assert.equal(reboot.burrowAttentionCounts(data).rooms.friends_room,0);
  data.moments[0].created_at='2026-10-10T13:00:00Z';assert.equal(reboot.burrowAttentionCounts(data).tabs.friends,1);
  data.pairVersion='v2';assert.equal(reboot.burrowAttentionCounts(data).letter,1);
  h.change('other');assert.equal(h.api.burrowAttentionCounts(data).tabs.index,0);
  assert.ok([...h.disk.values()].every(value=>!value.includes('Hello')),'never persist message text in read state');
});
test('opening the Home envelope clears its reminder immediately, not the unread queue; new arrivals alert again',()=>{
  const h=harness(),data=snapshot();data.memoryEntries.push({id:'second',author_id:'them',body:'💌 Second',updated_at:at});
  assert.equal(h.api.burrowAttentionCounts(data).letter,2);
  h.api.dismissHomeLetterReminder(data);assert.equal(h.api.burrowAttentionCounts(data).letter,0);
  assert.equal(h.api.unreadBurrowUpdateIds(data,'letters').length,2,'unread bodies still open oldest first');
  const reboot=h.restart();assert.equal(reboot.burrowAttentionCounts(data).letter,0);
  assert.equal(reboot.unreadBurrowUpdateIds(data,'letters').length,2);
  data.memoryEntries.push({id:'new-arrival',author_id:'them',body:'💌 New',updated_at:at});
  assert.equal(reboot.burrowAttentionCounts(data).letter,1,'only newly arrived notes need a fresh reminder');
  data.memoryEntries[0].updated_at='2026-10-11T00:00:00Z';assert.equal(reboot.burrowAttentionCounts(data).letter,2);
  data.pairVersion='new';assert.equal(reboot.burrowAttentionCounts(data).letter,3);
  h.change('other');reboot.dismissHomeLetterReminder(data);h.change('me');assert.equal(h.api.burrowAttentionCounts(data).letter,3);
  assert.ok([...h.disk.values()].every(value=>!value.includes('Second')));
  const home=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  // Current unread-first Love Note contract: Home delegates reading/compose
  // choice to the shared screen, never forces compose or consumes unread here.
  assert.match(home,/onLetter=\{\(\)=>openHomeInteraction\('letter'\)\}/);
});
test('opening an arrived Adventure keeps its pending-reward badge through refresh and restart',()=>{
  const h=harness(),data=snapshot(),before=JSON.stringify(data);
  assert.equal(h.api.burrowAttentionCounts(data).adventure,1);
  h.api.dismissAdventureReminder(data);
  assert.equal(h.api.burrowAttentionCounts(data).adventure,1);assert.equal(JSON.stringify(data),before);
  assert.equal(h.restart().burrowAttentionCounts(data).adventure,1);
  data.activeAdventure.status='interaction_required';assert.equal(h.api.burrowAttentionCounts(data).adventure,1);
  data.activeAdventure.status='in_progress';assert.equal(h.api.burrowAttentionCounts(data).adventure,1,'a stale due snapshot cannot hide incomplete rewards');
  data.activeAdventure.id='next-journey';assert.equal(h.api.burrowAttentionCounts(data).adventure,1);
  h.change('other');h.api.dismissAdventureReminder(data);h.change('me');assert.equal(h.api.burrowAttentionCounts(data).adventure,1);
  data.pairVersion='new-pair';assert.equal(h.api.burrowAttentionCounts(data).adventure,1);
});
test('opening ongoing does not suppress its future arrival; the monotonic due time can acknowledge before status refresh',()=>{
  const h=harness(),data=snapshot(),now=Date.parse(at);data.activeAdventure.status='in_progress';data.activeAdventure.ends_at=new Date(now+1000).toISOString();
  h.api.dismissAdventureReminder(data,now);assert.equal(h.api.burrowAttentionCounts(data,now+1000).adventure,1);
  h.api.dismissAdventureReminder(data,now+1000);assert.equal(h.api.burrowAttentionCounts(data,now+1000).adventure,1);
});
test('claim decrements immediately, rolls back failure, persists success, and next stage is separate',()=>{
  const h=harness(),data=snapshot();let settle=h.api.beginQuestAttentionClaim(data,'daily:q1');
  assert.equal(h.api.burrowAttentionCounts(data).tabs.quests,1);settle(false);assert.equal(h.api.burrowAttentionCounts(data).tabs.quests,2);
  settle=h.api.beginQuestAttentionClaim(data,'daily:q1');settle(true);assert.equal(h.restart().burrowAttentionCounts(data).tabs.quests,1);
  h.api.beginQuestAttentionClaim(data,'special:games_played:1')(true);assert.equal(h.api.burrowAttentionCounts(data).tabs.quests,0);
  data.specialQuests[0].stage=2;assert.equal(h.api.burrowAttentionCounts(data).tabs.quests,1);
  settle=h.api.beginQuestAttentionClaim(data,'special:games_played:2');h.change('other');settle(true);h.change('me');
  assert.equal(h.api.burrowAttentionCounts(data).tabs.quests,1,'late receipt never changes a different session');
});
test('cached server metadata drives Game/Journal counts and is relationship-bound',()=>{
  const h=harness(),data=snapshot();data.attention={scope:h.api.attentionScope(data),localDate:data.localDate,moments:[],letters:[],games:[{id:'game:invite',at}],journal:[{id:'answer:version',at}]};
  assert.equal(h.api.burrowAttentionCounts(data).rooms.game_room,1);assert.equal(h.api.burrowAttentionCounts(data).rooms.memories_room,1);
  h.api.markBurrowUpdatesSeen(data,'games');h.api.markBurrowUpdatesSeen(data,'journal');assert.equal(h.api.burrowAttentionCounts(data).rooms.game_room,0);
  data.attention.games.push({id:'game:result',at});assert.equal(h.api.burrowAttentionCounts(data).rooms.game_room,1);
  data.localDate='2026-10-11';assert.equal(h.api.burrowAttentionCounts(data).rooms.memories_room,0);
  data.pairVersion='v2';assert.equal(h.api.burrowAttentionCounts(data).rooms.game_room,0);
});

function serverHarness({changePair=false,fail=false}={}){
  const calls=[];let locks=0;
  const tables={moment_events:[{id:'event',created_at:at,event_type:'toy_interacted',payload:{count:1}}],memory_room_entries:[{id:'note',updated_at:at}],
    burrow_game_sessions:[{id:'invitation',started_by:'them',completed_at:null,burrow_game_progress:[{user_id:'them',own_answers:Array(6).fill(0),guesses:Array(6).fill(1),updated_at:at}]},
      {id:'mine',started_by:'me',completed_at:at,burrow_game_progress:[]},{id:'unfinished',started_by:'them',completed_at:null,burrow_game_progress:[]}],
    couple_journal_pages:[{id:'page',couple_journal_answers:[{id:'answer',author_id:'them',updated_at:at,body:'private'},{id:'own',author_id:'me',updated_at:at}]}]};
  const db={rpc(name,args){calls.push({name,args});return Promise.resolve({data:name==='lock_burrow_pair'?(changePair&&++locks>1?'new-person':'them'):'v1'});},
    from(table){const query={then(resolve){return Promise.resolve({data:tables[table],error:fail?Error('offline'):null}).then(resolve);}};
      for(const method of ['select','eq','in','order','limit','is','like','abortSignal'])query[method]=(...args)=>{calls.push({table,method,args});return query;};return query;}};
  return {db,calls};
}
test('server emits metadata only, matches ready partner games / own results / today’s answer',async()=>{
  const {readBurrowAttention}=load('apps/api/src/lib/burrow-attention.mjs',{}, {AbortSignal});
  const h=serverHarness(),result=await readBurrowAttention(h.db,'me',snapshot());
  assert.deepEqual(plain(result.games.map(row=>row.id)),['invitation:invite','mine:result']);assert.equal(result.journal.length,1);
  assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('own_answers'));
  assert.ok(h.calls.some(row=>row.table==='couple_journal_pages'&&row.method==='eq'&&row.args[0]==='local_date'&&row.args[1]==='2026-10-10'));
  assert.ok(h.calls.some(row=>row.table==='burrow_game_sessions'&&row.method==='eq'&&row.args[0]==='pair_version'&&row.args[1]==='v1'));
  const events=h.calls.find(row=>row.table==='moment_events'&&row.method==='in'&&row.args[0]==='event_type').args[1];
  assert.ok(events.includes('gift_sent'));assert.ok(events.includes('surprise_sent'));
});
test('changed partner or failed supplemental read cannot leak former-pair metadata or block Home',async()=>{
  const {readBurrowAttention}=load('apps/api/src/lib/burrow-attention.mjs',{}, {AbortSignal});
  assert.equal(await readBurrowAttention(serverHarness({changePair:true}).db,'me',snapshot()),null);
  assert.equal(await readBurrowAttention(serverHarness({fail:true}).db,'me',snapshot()),null);
});
test('Adventure stays badge-only on launch and resume; receiving Surprise remains unchanged',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/adventure-arrival-gate.tsx','utf8');
  assert.doesNotMatch(source,/router\.|\.take\(/);assert.match(source,/refreshBurrowAfterCurrent/);
  const home=fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8');assert.match(home,/updates\?\.adventure.*?dot/);
});
test('letter inbox paints cached notes first, acknowledges only displayed IDs, and rejects late old-pair history',async()=>{
  const h=hooks(),requests=[],read=[],jsx=(type,props)=>({type,props});let epoch=1;
  const {LoveLetterInbox}=load('apps/mobile/src/components/burrow/love-letter-inbox.tsx',{
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Pressable:'Button',ScrollView:'Scroll',Text:'Text',View:'View'},
    '@react-navigation/native':{useIsFocused:()=>true},'@/lib/session-lifecycle':{sessionEpoch:()=>epoch},
    '@/lib/burrow-history':{fetchBurrowHistory:()=>{const request=deferred();requests.push(request);return request.promise;}},
    '@/lib/burrow-attention':{attentionScope:data=>`${data.profile.id}:${data.partner.id}:${data.pairVersion}`,burrowAttentionCounts:()=>({letter:3}),
      markBurrowUpdatesSeen:(_data,channel,ids)=>read.push({channel,ids:plain(ids)})},
  });
  const data=snapshot(),render=()=>h.render(()=>LoveLetterInbox({data}));
  const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
  assert.ok(nodes(render()).some(row=>row.props?.children==='Hello'));assert.deepEqual(read[0].ids,[`letter:${at}`]);
  requests[0].resolve({rows:[{id:'older',author_id:'them',body:'💌 Old note',updated_at:at,localDate:'2026-10-10'}],next:null});await flush();
  assert.ok(nodes(render()).some(row=>row.props?.children==='Old note'));assert.equal(read.at(-1).ids.length,2,'an unseen third note is not cleared');
  data.pairVersion='v2';render();epoch++;requests[1].resolve({rows:[{id:'late',author_id:'them',body:'💌 Late private note',updated_at:at,localDate:'2026-10-10'}],next:null});await flush();
  assert.ok(!nodes(render()).some(row=>row.props?.children==='Late private note'));h.unmount();
});
