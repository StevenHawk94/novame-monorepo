const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,flush}=require('./lifecycle-test-utils.cjs');
function harness(){
  const time=clock(),calls=[],values=new Map(),questFacts=[],momentReads=[];let identity,foreground,fail='invalid_action',refreshes=0;
  const data={profile:{id:'11111111-1111-4111-8111-111111111111',timezone_name:'UTC'},partner:null,pairVersion:null,
    localDate:'2026-10-14',serverNow:'2026-10-14T12:00:00Z',roomPhotos:[{id:'photo-a',ownerId:'11111111-1111-4111-8111-111111111111',kind:'doll',toyId:'toy-a',updatedAt:'2026-10-14T12:00:00Z'}]};
  let state={data,pairInvalidated:false,receivedAt:10000},active='active',photoState='unknown';
  const batcher=load('apps/mobile/src/lib/toy-interaction-batcher.ts',{},time.globals);
  const api=load('apps/mobile/src/lib/toy-interaction-records.ts',{
    './quest-progress-store':{questProgress:{fact:(id,intent,status)=>questFacts.push({id,intent,status})}},
    './moments-cache':{momentsCache:{retry:async data=>momentReads.push(data)}},
    'react-native':{AppState:{get currentState(){return active;},addEventListener:(_name,fn)=>{foreground=fn;}}},'expo-crypto':{randomUUID:()=> '33333333-3333-4333-8333-333333333333'},
    './storage':{storage:{getString:key=>values.get(key),set:(key,value)=>values.set(key,value),remove:key=>values.delete(key)}},
    '../shared/storage/keys':{kToyInputBatches:{name:'burrow:toy-input-batches:v2',scope:'user'}},
    './burrow-store':{getBurrowSnapshot:()=>state,burrowClock:()=>time.globals.Date.now(),scheduleBurrowRefresh:()=>refreshes++,plushiePhotoSyncState:()=>photoState},
    './burrow-toy-photos':load('apps/mobile/src/lib/burrow-toy-photos.ts'),
    './burrow-local-day':load('apps/mobile/src/lib/burrow-local-day.ts',{}, {Intl,Date}),
    './session-lifecycle':{sessionEpoch:()=>1,subscribeSessionIdentity:fn=>{identity=fn;},sessionUserId:()=>state.data?.profile.id},
    './toy-interaction-batcher':batcher,
    './app-major-update-api':{
      interactBurrowToyWindow:async(scope,batch)=>{calls.push({kind:'window',...batch,scope});if(fail)throw Object.assign(Error(fail),{body:{error:fail}});},
    },
  },time.globals);
  return {api,time,calls,values,data,questFacts,momentReads,setPhotoState:s=>photoState=s,setFail:code=>{fail=code;},setState:value=>{state=value;},foreground:()=>foreground('active'),identity:()=>identity(),get refreshes(){return refreshes;}};
}
test('confirmed interaction refreshes only the current Moments head, coalesced and cancelled on identity loss',async()=>{
 const h=harness();h.setFail(null);h.api.recordToyInteraction('toy-a');h.time.advance(250);await flush();
 assert.equal(h.momentReads.length,0);h.time.advance(500);await flush();assert.equal(h.momentReads.length,1);
 h.api.recordToyInteraction('toy-a');h.time.advance(250);await flush();h.setState({data:null,pairInvalidated:true});h.identity();
 h.time.advance(1000);assert.equal(h.momentReads.length,1);
});
test('old API cannot silently fall back to daily/photo-less counting; inputs remain durable until API upgrade',async()=>{
  const h=harness();for(let i=0;i<8;i++)h.api.recordToyInteraction('toy-a');h.time.advance(250);await flush();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].count,8);assert.equal(h.refreshes,0);
  h.setFail(null);h.foreground();await flush();assert.equal(h.calls[1].id,h.calls[0].id);assert.equal(h.refreshes,1);
});
test('unknown/uncertain server errors never fall back and risk double recording; explicit recovery retries the same ID',async()=>{
  const h=harness();h.setFail('Internal error');h.api.recordToyInteraction('toy-a');h.time.advance(250);await flush();
  assert.equal(h.calls.filter(c=>c.kind==='legacy').length,0);const id=h.calls[0].id;
  h.setFail(null);h.foreground();await flush();assert.equal(h.calls[1].id,id);assert.equal(h.refreshes,1);
  h.setState({data:null,pairInvalidated:true});h.identity();assert.equal(h.values.size,0);
});
test('only the displayed photo-bearing toy counts; another toy photo cannot qualify an empty one',async()=>{
  const h=harness();h.setFail(null);h.api.recordToyInteraction('toy-empty');h.api.recordToyInteraction();
  h.time.advance(250);await flush();assert.equal(h.calls.length,0);assert.equal(h.values.size,0);assert.equal(h.questFacts.length,0);
  h.api.recordToyInteraction('toy-a');assert.equal(h.questFacts.at(-1).status,'pending','Claim is ready before the batch delay');
  h.time.advance(250);await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].photoId,'photo-a');
  assert.equal(h.questFacts.at(-1).status,'confirmed');
});
test('local pending photo qualifies without waiting; midnight uses projected server clock, not stale bootstrap day',async()=>{
  const h=harness();h.setFail(null);h.data.roomPhotos[0].id='local-plushie-33333333-3333-4333-8333-333333333333';
  h.data.serverNow='2026-10-14T23:59:59Z';h.api.recordToyInteraction('toy-a');h.time.advance(250);await flush();
  const start=h.calls[0].windowStartedAt;h.time.advance(1000);h.api.recordToyInteraction('toy-a');h.time.advance(250);await flush();
  assert.equal(h.calls[1].windowStartedAt,start);assert.equal(h.calls[1].localDate,'2026-10-15');assert.ok(h.calls[1].photoId.startsWith('local-plushie-'));
});
test('pending photo records locally without polling API; rejected photo drains without granting any count',async()=>{
  const h=harness();h.setFail(null);h.data.roomPhotos[0].id='local-plushie-33333333-3333-4333-8333-333333333333';h.setPhotoState('pending');
  h.api.recordToyInteraction('toy-a');h.time.advance(250);await flush();assert.equal(h.calls.length,0);assert.equal(h.values.size,1);
  h.time.advance(2000);await flush();assert.equal(h.calls.length,0);h.setPhotoState('failed');h.foreground();await flush();
  assert.equal(h.calls.length,0);const q=JSON.parse([...h.values.values()][0]);assert.equal(q.batch,null);assert.equal(q.pending.length,0);
  assert.equal(h.questFacts.at(-1).status,'rejected','a failed photo must invalidate its optimistic quest');
});
