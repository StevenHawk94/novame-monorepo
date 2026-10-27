const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,flush,clock,deferred,hooks}=require('./lifecycle-test-utils.cjs');
const contract=load('packages/domain/src/plushie-touch.ts');
const recorder=load('apps/mobile/src/lib/plushie-touch-recorder.ts',{'@novame/domain':contract});
const clip=()=>({version:1,durationMs:60000,touches:1,events:[[0,4,0,0,0]]});
function harness(){
 const time=clock(),disk=new Map(),calls=[],prepared=[];let failSave=false,post=async()=>({success:true,version:1}),identity='A',observer;
 const pair='a'.repeat(32),photo={id:'photo',ownerId:'B',kind:'doll',updatedAt:'2026-10-25'};
 let snap={data:{profile:{id:'A'},partner:{id:'B'},pairVersion:pair,roomPhotos:[photo]}};
 let meta={version:1,userId:'A',partnerId:'B',pairVersion:pair,localDate:'2026-10-25',serverNow:'2026-10-25T00:00Z',hasPlus:false,remaining:1,sameDomain:true,items:[]};
 const message=id=>({...meta.items.find(m=>m.id===id),clip:clip(),toy:{stable_id:'toy'},photo});
 const mod=load('apps/mobile/src/lib/plushie-touch-store.ts',{
  react:{useSyncExternalStore:(_sub,get)=>get()},'react-native':{AppState:{currentState:'active'}},'expo-crypto':{randomUUID:()=> 'key-'+calls.length},'@novame/domain':contract,
  './plushie-touch-recorder':recorder,
  './api':{apiClient:{get:async url=>{calls.push({get:url});return url.includes('&id=')?{version:meta.version,userId:'A',partnerId:'B',pairVersion:pair,message:message(url.split('&id=')[1])}:meta;},post:async(url,body)=>{calls.push({post:url,body});return post(body);}}},
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>{if(failSave)throw Error('disk_full');disk.set(k,v);},remove:k=>disk.delete(k)}},
  '../shared/storage/keys':{kPlushieTouch:{name:'state'},kPlushieTouchDraft:{name:'draft'},kPlushieTouchGuide:{name:'guide'},kPlushieTouchRecording:{name:'recording'}},
  './burrow-store':{getBurrowSnapshot:()=>snap},'./session-lifecycle':{sessionUserId:()=>identity,subscribeSessionIdentity:fn=>{observer=fn;}},
  './burrow-art-assets':{burrowArtForItem:()=>({source:'bundled-toy'})},'./burrow-room-photo-cache':{loadRoomPhoto:async p=>{prepared.push(p.id);return'private-local';}},
  './prepared-burrow-images':{prepareBurrowImage:async()=>{prepared.push('art');}},
 },time.globals);
 mod.setPlushieTouchScope({user:'A',partner:'B',pair});
 return{...mod,time,disk,calls,prepared,pair,get meta(){return meta;},set meta(v){meta=v;},setPost:fn=>{post=fn;},fail:v=>{failSave=v;},switch(){identity='C';snap={data:null};observer();},row:id=>({id,sender_id:'B',recipient_id:'A',pair_version:pair,toy_id:'toy',read_at:null,created_at:'2026-10-25',expires_at:null})};
}
test('recording draft is durable, scoped, and queueing never sends before local acceptance',async()=>{
 const q=harness();await q.refreshPlushieTouch();q.saveTouchDraft('toy','photo',clip());assert.equal(q.touchDraft().clip.touches,1);
 q.fail(true);assert.throws(()=>q.queuePlushieTouch('toy','photo',clip()),/disk_full/);assert.equal(q.calls.filter(c=>c.post).length,0);
 q.fail(false);q.queuePlushieTouch('toy','photo',clip());await flush();assert.equal(q.touchSnapshot().jobs[0].state,'committed');assert.equal(q.touchDraft(),null);
 assert.equal(JSON.parse(q.disk.get('state')).prepared&&Object.keys(JSON.parse(q.disk.get('state')).prepared).length,0);q.pausePlushieTouch();
});
test('partial recording is durable but never sendable; stale pair cannot recover it; disk failure keeps last checkpoint',async()=>{
 const q=harness();await q.refreshPlushieTouch();const r=recorder.createTouchRecorder();r.input([0,4,0,0,0]);
 const scope=`A:B:${q.pair}`;
 q.saveTouchRecording('toy','photo',r.checkpoint(19000),scope);assert.equal(q.touchRecording().checkpoint.elapsedMs,19000);
 q.fail(true);assert.throws(()=>q.saveTouchRecording('toy','photo',r.checkpoint(20000),scope),/disk_full/);q.fail(false);
 assert.equal(q.touchRecording().checkpoint.elapsedMs,19000);assert.equal(q.touchDraft(),null);
 assert.throws(()=>q.queuePlushieTouch('toy','photo',q.touchRecording().checkpoint),/touch_not_ready/);
 assert.throws(()=>q.saveTouchRecording('toy','photo',r.checkpoint(21000),'old:pair:scope'),/touch_not_ready/);
 assert.throws(()=>q.saveTouchDraft('toy','photo',clip(),'old:pair:scope'),/touch_not_ready/);
 assert.throws(()=>q.queuePlushieTouch('toy','photo',clip(),'old:pair:scope'),/touch_not_ready/);
 q.setPlushieTouchScope(null);assert.equal(q.touchRecording(),null);assert.equal(q.disk.has('recording'),false);q.pausePlushieTouch();
});
test('storage failure while setting a root-gate scope does not crash unrelated App features or accept a new send',()=>{
 const q=harness();q.fail(true);assert.doesNotThrow(()=>q.setPlushieTouchScope(null));assert.equal(q.touchSnapshot().scope,'');
 assert.match(q.touchSnapshot().error,/storage/);assert.throws(()=>q.queuePlushieTouch('toy','photo',clip()),/touch_not_ready/);assert.equal(q.calls.length,0);
});
test('uncertain send retries exactly the same immutable payload/key; committed local observer/storage errors cannot reject it',async()=>{
 const q=harness();await q.refreshPlushieTouch();let attempts=0;q.setPost(async()=>{if(++attempts===1)throw Error('timeout');q.fail(true);return{success:true,version:1};});
 q.queuePlushieTouch('toy','photo',clip());await flush();assert.equal(q.touchSnapshot().jobs[0].state,'queued');
 const original=JSON.stringify(q.calls.find(c=>c.post).body);q.time.advance(2000);await flush();assert.equal(q.touchSnapshot().jobs[0].state,'committed');
 assert.equal(JSON.stringify(q.calls.filter(c=>c.post)[1].body),original);assert.equal(attempts,2);q.pausePlushieTouch();
});
test('caller mutations after queueing cannot alter the durable retry or the pending clip',async()=>{
 const q=harness();await q.refreshPlushieTouch();const pending=deferred();q.setPost(()=>pending.promise);const original=clip();q.queuePlushieTouch('toy','photo',original);
 original.events[0][0]=500;original.events.push([1000,4,0,0,0]);original.touches=2;
 assert.equal(q.touchSnapshot().jobs[0].payload.clip.events[0][0],0);assert.equal(q.touchSnapshot().jobs[0].payload.clip.touches,1);
 pending.resolve({success:true,version:1});await flush();q.pausePlushieTouch();
});
test('badge requires prepared current content, opening history alone does not clear unread, playback marks one ID',async()=>{
 const q=harness();q.meta={...q.meta,items:[q.row('one'),q.row('two')]};assert.equal(q.usePlushieTouchBadge(),0);await q.refreshPlushieTouch();
 assert.equal(q.usePlushieTouchBadge(),2);assert.ok(q.prepared.includes('photo'));assert.equal(q.touchMessage('one').clip.touches,1);
 q.setPost(async body=>{if(body.action==='seen')throw Object.assign(Error('removed'),{status:404});return{};});
 q.markTouchPlayed('one');assert.equal(q.usePlushieTouchBadge(),1);await flush();assert.equal(q.touchSnapshot().seen.length,0);q.pausePlushieTouch();
});
test('Free latest replacement removes old prepared payload; new identity discards late incoming bytes and send callbacks',async()=>{
 const q=harness();q.meta={...q.meta,items:[q.row('old')]};await q.refreshPlushieTouch();assert.ok(q.touchMessage('old'));
 q.meta={...q.meta,items:[q.row('new')]};await q.refreshPlushieTouch();assert.equal(q.touchMessage('old'),undefined);assert.ok(q.touchMessage('new'));
 const pending=deferred();q.setPost(()=>pending.promise);q.queuePlushieTouch('toy','photo',clip());await flush();q.switch();pending.resolve({success:true,version:1});await flush();
 assert.equal(q.touchSnapshot().scope,'');assert.equal(q.touchSnapshot().jobs.length,0);assert.equal(q.usePlushieTouchBadge(),0);q.pausePlushieTouch();
});
test('definitive rejection preserves recording without silent new key/date; explicit recovery creates a scoped draft',async()=>{
 const q=harness();await q.refreshPlushieTouch();q.setPost(async()=>{throw{body:{error:'touch_period_expired'}};});
 const key=q.queuePlushieTouch('toy','photo',clip());await flush();assert.equal(q.touchSnapshot().jobs[0].state,'blocked');
 const recovered=q.recoverTouchJob(key);assert.equal(recovered.touches,1);assert.equal(q.touchDraft().toyId,'toy');assert.equal(q.calls.filter(c=>c.post).length,1);q.pausePlushieTouch();
});
test('explicit recovery retries the SAME immutable failed intent and key, never silently changes its economic date',async()=>{
 const q=harness();await q.refreshPlushieTouch();q.setPost(async()=>{throw{body:{error:'touch_toy_unavailable'}};});const key=q.queuePlushieTouch('toy','photo',clip());await flush();
 const original=JSON.stringify(q.calls.find(c=>c.post).body);q.recoverTouchJob(key);q.meta={...q.meta,localDate:'2026-10-26'};await q.refreshPlushieTouch();
 q.setPost(async()=>({success:true,version:1}));assert.equal(q.queuePlushieTouch('toy','photo',q.touchDraft().clip,undefined,q.touchDraft().recoveryKey),key);await flush();
 assert.equal(JSON.stringify(q.calls.filter(c=>c.post)[1].body),original);q.pausePlushieTouch();
});
test('Plus shared outgoing history can prepare/replay without clearing incoming unread or creating its own badge',async()=>{
 const q=harness(),own={...q.row('own'),sender_id:'A',recipient_id:'B'};q.meta={...q.meta,version:2,hasPlus:true,items:[own,q.row('received')]};await q.refreshPlushieTouch();
 assert.ok(q.touchMessage('own'));assert.equal(q.usePlushieTouchBadge(),1);q.markTouchPlayed('own');await flush();
 assert.equal(q.usePlushieTouchBadge(),1);assert.equal(q.calls.filter(c=>c.body?.action==='seen').length,0);
 q.markTouchPlayed('received');assert.equal(q.usePlushieTouchBadge(),0);await flush();assert.equal(q.calls.filter(c=>c.body?.action==='seen').length,1);q.pausePlushieTouch();
});
test('discarding a recovered rejected intent really removes its retained content; queued sends cannot be discarded',async()=>{
 const q=harness();await q.refreshPlushieTouch();const pending=deferred();q.setPost(()=>pending.promise);const key=q.queuePlushieTouch('toy','photo',clip());
 assert.throws(()=>q.discardBlockedTouchJob(key,`A:B:${q.pair}`),/touch_pending/);
 pending.reject({body:{error:'touch_toy_unavailable'}});await flush();q.recoverTouchJob(key);assert.equal(q.touchDraft().recoveryKey,key);
 assert.throws(()=>q.discardBlockedTouchJob(key,'other:scope'),/touch_not_ready/);q.discardBlockedTouchJob(key,`A:B:${q.pair}`);q.discardTouchDraft();
 assert.equal(q.touchSnapshot().jobs.length,0);assert.equal(q.touchDraft(),null);assert.equal(q.calls.filter(c=>c.post).length,1);q.pausePlushieTouch();
});
test('touch gate coalesces only its own signal; feature cleanup never shuts down the shared Burrow transport',()=>{
 const h=hooks(),time=clock(),signals=load('apps/mobile/src/lib/plushie-touch-signals.ts');let refreshed=0,resumed=0,removed=0,scopes=[];
 const {PlushieTouchSyncGate}=load('apps/mobile/src/components/burrow/plushie-touch-sync-gate.tsx',{
  react:h.react,'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){removed++;}})}},
  '@/lib/burrow-store':{useBurrowSelector:select=>select({data:{profile:{id:'A'},partner:{id:'B'},pairVersion:'pair'}})},
  '@/lib/plushie-touch-signals':signals,'@/lib/plushie-touch-store':{refreshPlushieTouch:()=>refreshed++,resumePlushieTouch:()=>resumed++,pausePlushieTouch(){},setPlushieTouchScope:s=>scopes.push(s)},
 },time.globals);
 h.render(PlushieTouchSyncGate);assert.equal(refreshed,1);assert.equal(resumed,1);assert.equal(scopes[0].user,'A');
 signals.notifyPlushieTouchSignal('B');time.advance(200);assert.equal(refreshed,1);
 signals.notifyPlushieTouchSignal('A');signals.notifyPlushieTouchSignal('A');time.advance(119);assert.equal(refreshed,1);time.advance(1);assert.equal(refreshed,2);
 signals.notifyPlushieTouchSignal('A');h.unmount();time.advance(500);signals.notifyPlushieTouchSignal('A');time.advance(500);assert.equal(refreshed,2);assert.equal(removed,1);
});
