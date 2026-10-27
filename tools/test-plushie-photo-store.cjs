const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const plain=x=>JSON.parse(JSON.stringify(x)),lib='apps/mobile/src/lib/';
const old={id:'photo-1',ownerId:'A',toyId:'toy',kind:'doll',updatedAt:'2026-10-19T10:00:00Z'};
const receipt={photoId:old.id,photo:{...old,updatedAt:'2026-10-20T10:00:00Z'},photoUsage:{localDate:'2026-10-20',doll:{limit:1,targets:[{ownerId:'A',toyId:'toy',used:1}]}}};
const initial=()=>({profile:{id:'A'},partner:{id:'B'},pairVersion:'pair',catalog:[],loadouts:[],inventory:[],roomPhotos:[old],memoryEntries:[],moments:[],affectionInbox:[],gifts:[],wallet:{balance:10,version:0},
  localDate:'2026-10-20',photoUsage:{localDate:'2026-10-20',doll:{limit:1,targets:[]}},serverNow:'2026-10-20T10:00:00Z'});
function harness({disk=new Map(),files=new Set(),server=initial()}={}){
  const time=clock(),calls=[],commands=[],notices=[],identity=[],apps=[];let owner='A',epoch=1,active='active',failDisk=false;
  const storage={getString:key=>disk.get(key),set:(key,value)=>disk.set(key,value)};
  const keys={kBurrowRoomEdits:{keyFor:id=>'room:'+id},kShopGiftClaims:{keyFor:id=>'gift:'+id},kPlushiePhotoOutbox:{keyFor:id=>'photo-outbox:'+id},
    kBurrowSnapshot:{name:'snapshot'},kBurrowWallet:{name:'wallet'},kBurrowActionKeys:{name:'keys'},kBurrowRoomPhotoCache:{name:'photo-cache'}};
  const session={sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:f=>{identity.push(f);return()=>{};}};
  const photoCache=load(lib+'burrow-room-photo-cache.ts',{
    'react-native':{Image:{getSize:async()=>({width:400,height:400})}},
    './session-lifecycle':session,'./storage':{storage},'../shared/storage/keys':keys,
    '../shared/storage/artifacts':{BURROW_ROOM_PHOTO_DIRECTORY:'file:///photos/',waitForRoomPhotoCleanup:async()=>{}},
    './app-major-update-api':{fetchRoomPhoto:async()=>{throw Error('unexpected download');}},
    'expo-file-system/legacy':{EncodingType:{Base64:'base64'},makeDirectoryAsync:async()=>{},
      deleteAsync:async path=>files.delete(path),writeAsStringAsync:async path=>{if(failDisk)throw Error('disk_full');files.add(path);},
      moveAsync:async({from,to})=>{assert.ok(files.has(from));files.delete(from);files.add(to);},getInfoAsync:async path=>({exists:files.has(path)})},
  },time.globals);
  const api=load(lib+'burrow-store.ts',{
    react:{useCallback:f=>f,useRef:x=>({current:x}),useSyncExternalStore:(_s,get)=>get()},'expo-router':{useFocusEffect(){}},'@react-navigation/native':{useIsFocused:()=>true},
    'react-native':{AppState:{get currentState(){return active;},addEventListener:(_event,f)=>{apps.push(f);return{remove(){}};}}},
    'expo-crypto':{randomUUID:()=> 'random'},'./session-lifecycle':session,'./storage':{storage},'../shared/storage/keys':keys,
    './adventure-arrival':load(lib+'adventure-arrival.ts'),'./async-lifecycle':load(lib+'async-lifecycle.ts',{},time.globals),
    './burrow-cache':load(lib+'burrow-cache.ts',{'./storage':{storage},'../shared/storage/keys':keys},time.globals),
    './burrow-room-photo-cache':photoCache,'./burrow-toast':{showBurrowToast:message=>notices.push(message)},
    './api':{apiClient:{post:async(path,payload,options)=>{const result=deferred();commands.push({path,payload,options,...result});return result.promise;}}},
    './app-major-update-api':{fetchMajorUpdateBootstrap:async()=>plain(server),saveRoomPhoto:async(...args)=>{const d=deferred();calls.push({args,...d});return d.promise;}},
    './coin-reward-store':{syncCoinWallet(){},useCoinBalance:()=>null,setCoinRewardReconciler(){},subscribeCoinWallet(){},getConfirmedCoinWallet:()=>null},
  },{...time.globals,performance:{now:()=>time.globals.Date.now()}});
  return {api,photoCache,disk,files,time,calls,commands,notices,get data(){return api.getBurrowSnapshot().data;},server:v=>{server=v;},
    failDisk:v=>{failDisk=v;},app:v=>{active=v;apps.forEach(f=>f(v));},identity:v=>{owner=v;epoch++;identity.forEach(f=>f());}};
}
test('real store + durable cache: Home sees crop before network, receipt reuses file and confirms quota once',async()=>{
  const h=harness();await h.api.refreshBurrow();const before=h.data;
  await h.api.enqueuePlushiePhoto(before,'A','toy','anBlZw==','one');
  assert.equal(h.calls.length,0);assert.equal(h.data.roomPhotos[0].id,'local-plushie-one');
  const uri=h.photoCache.cachedRoomPhotoUri(h.data.roomPhotos[0]);assert.ok(h.files.has(uri));
  assert.equal(h.data.photoUsage.doll.targets.length,0,'pending selection cannot fabricate cloud quota');
  const {toyPhotoChangedToday}=load(lib+'burrow-toy-photos.ts');assert.equal(toyPhotoChangedToday(h.data,'toy'),true,'pending target blocks another simultaneous upload');
  await h.api.refreshBurrow({silent:true});assert.equal(h.data.roomPhotos[0].id,'local-plushie-one');
  h.time.advance(0);await flush();assert.equal(h.calls.length,1);h.calls[0].resolve(receipt);await flush();
  assert.equal(h.data.roomPhotos[0].id,'photo-1');assert.equal(h.photoCache.cachedRoomPhotoUri(receipt.photo),uri);assert.ok(h.files.has(uri));
  assert.deepEqual(plain(h.data.photoUsage),receipt.photoUsage);assert.deepEqual(JSON.parse(h.disk.get('photo-outbox:A')),[]);
  await h.api.refreshBurrow({silent:true});assert.equal(h.data.roomPhotos[0].updatedAt,receipt.photo.updatedAt,'stale bootstrap cannot undo confirmed receipt');
});
test('real store restores pending crop offline after restart and resumes same actor/owner/toy/key',async()=>{
  const a=harness();await a.api.refreshBurrow();await a.api.enqueuePlushiePhoto(a.data,'A','toy','anBlZw==','one');a.app('background');
  const b=harness({disk:a.disk,files:a.files});assert.equal(b.data.roomPhotos[0].id,'local-plushie-one');
  assert.ok(b.files.has(b.photoCache.cachedRoomPhotoUri(b.data.roomPhotos[0])));b.time.advance(0);await flush();
  assert.deepEqual(plain(b.calls[0].args),['A','doll','anBlZw==','one','A','B','toy']);b.calls[0].resolve(receipt);await flush();assert.equal(b.data.roomPhotos[0].id,'photo-1');
});
test('local disk failure cannot close/accept or send; rejected cloud quota restores previous crop',async()=>{
  const h=harness();await h.api.refreshBurrow();h.failDisk(true);
  await assert.rejects(h.api.enqueuePlushiePhoto(h.data,'A','toy','anBlZw==','one'),/disk_full/);
  assert.equal(h.calls.length,0);assert.equal(h.data.roomPhotos[0].id,'photo-1');assert.equal(h.disk.has('photo-outbox:A'),false);
  h.failDisk(false);await h.api.enqueuePlushiePhoto(h.data,'A','toy','anBlZw==','one');h.time.advance(0);await flush();
  h.calls[0].reject({body:{error:'daily_limit_reached'}});await flush();
  assert.equal(h.data.roomPhotos[0].id,'photo-1');assert.equal(h.notices.length,1);assert.equal(h.data.photoUsage.doll.targets.length,0);
});
test('changed account during local processing cannot project or upload the old face',async()=>{
  const h=harness();await h.api.refreshBurrow();const save=h.api.enqueuePlushiePhoto(h.data,'A','toy','anBlZw==','one');h.identity('C');
  await assert.rejects(save,/session_changed/);h.time.advance(0);await flush();assert.equal(h.calls.length,0);assert.equal(h.data,null);
});

const frame={id:'frame-old',kind:'frame',ownerId:'A',updatedAt:'2026-10-19T10:00:00Z'};
const withFrame=()=>({...initial(),roomPhotos:[old,frame],photoUsage:{...initial().photoUsage,frame:{limit:3,used:0,remaining:3}}});
const currentFrame=h=>h.data.roomPhotos.find(p=>p.kind==='frame');
const frameReceipt=(id='frame-new',updatedAt='2026-10-20T10:00:01Z')=>({photoId:id,photo:{...frame,id,updatedAt}});
test('frame crop is durable and visible immediately; confirmation reuses local file without blocking Plushie photos',async()=>{
  const h=harness({server:withFrame()});await h.api.refreshBurrow();
  await h.api.enqueueFramePhoto(h.data,'A','anBlZw==','one');
  assert.equal(h.calls.length,0);assert.equal(currentFrame(h).id,'local-frame-one');
  const uri=h.photoCache.cachedRoomPhotoUri(currentFrame(h));assert.ok(h.files.has(uri));
  assert.equal(h.data.roomPhotos.find(p=>p.kind==='doll').id,old.id);assert.equal(h.data.photoUsage.frame.used,0);
  await h.api.refreshBurrow({silent:true});assert.equal(currentFrame(h).id,'local-frame-one');
  h.time.advance(0);await flush();assert.deepEqual(plain(h.calls[0].args),['A','frame','anBlZw==','one','A','B']);
  h.calls[0].resolve(frameReceipt());await flush();
  assert.equal(currentFrame(h).id,'frame-new');assert.equal(h.photoCache.cachedRoomPhotoUri(currentFrame(h)),uri);
  assert.deepEqual(JSON.parse(h.disk.get('frame-outbox:A')),[]);
});
test('frame queue restores offline after relaunch and retries the same bytes/key silently',async()=>{
  const a=harness({server:withFrame()});await a.api.refreshBurrow();await a.api.enqueueFramePhoto(a.data,'A','anBlZw==','one');
  a.time.advance(0);await flush();a.calls[0].reject(Error('offline'));await flush();assert.equal(a.notices.length,0);a.app('background');
  const b=harness({disk:a.disk,files:a.files,server:withFrame()});assert.equal(currentFrame(b).id,'local-frame-one');
  assert.ok(b.files.has(b.photoCache.cachedRoomPhotoUri(currentFrame(b))));b.time.advance(0);await flush();
  assert.deepEqual(plain(b.calls[0].args),plain(a.calls[0].args));b.calls[0].resolve(frameReceipt());await flush();
  assert.equal(currentFrame(b).id,'frame-new');assert.equal(b.notices.length,0);
});
test('successive frame selections stay latest while earlier receipts settle; later rejection restores confirmed frame',async()=>{
  const h=harness({server:withFrame()});await h.api.refreshBurrow();
  await h.api.enqueueFramePhoto(h.data,'A','first','one');await h.api.enqueueFramePhoto(h.data,'A','second','two');
  assert.equal(currentFrame(h).id,'local-frame-two');h.time.advance(0);await flush();assert.equal(h.calls.length,1);
  h.calls[0].resolve(frameReceipt());await flush();assert.equal(currentFrame(h).id,'local-frame-two');
  h.time.advance(0);await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[1].args[2],'second');
  h.calls[1].reject({body:{error:'daily_limit_reached'}});await flush();
  assert.equal(currentFrame(h).id,'frame-new');assert.equal(h.notices.length,1);
  assert.equal(h.data.roomPhotos.find(p=>p.kind==='doll').id,old.id);
});
test('frame disk failure is not accepted; duplicate immutable key cannot double submit or mutate bytes',async()=>{
  const h=harness({server:withFrame()});await h.api.refreshBurrow();h.failDisk(true);
  await assert.rejects(h.api.enqueueFramePhoto(h.data,'A','first','one'),/disk_full/);assert.equal(currentFrame(h).id,frame.id);
  h.failDisk(false);await h.api.enqueueFramePhoto(h.data,'A','first','one');await h.api.enqueueFramePhoto(h.data,'A','first','one');
  await assert.rejects(h.api.enqueueFramePhoto(h.data,'A','different','one'),/idempotency_conflict/);
  assert.equal(JSON.parse(h.disk.get('frame-outbox:A')).length,1);h.time.advance(0);await flush();assert.equal(h.calls.length,1);
  h.calls[0].resolve(frameReceipt());await flush();
});
test('frame cannot leak a late upload or locally processed file across account changes',async()=>{
  const h=harness({server:withFrame()});await h.api.refreshBurrow();await h.api.enqueueFramePhoto(h.data,'A','first','one');
  h.time.advance(0);await flush();h.identity('C');h.calls[0].resolve(frameReceipt());await flush();assert.equal(h.data,null);
  const b=harness({server:withFrame()});await b.api.refreshBurrow();const saving=b.api.enqueueFramePhoto(b.data,'A','first','one');b.identity('C');
  await assert.rejects(saving,/session_changed/);b.time.advance(0);await flush();assert.equal(b.calls.length,0);
});

test('next frame keeps its confirmed rollback base durably even if the app stops before snapshot persistence',async()=>{
  const a=harness({server:withFrame()});await a.api.refreshBurrow();
  await a.api.enqueueFramePhoto(a.data,'A','first','one');await a.api.enqueueFramePhoto(a.data,'A','second','two');
  a.time.advance(0);await flush();a.calls[0].resolve(frameReceipt());await flush();a.app('background');
  assert.equal(JSON.parse(a.disk.get('frame-outbox:A'))[0].previous.id,'frame-new');
  const b=harness({disk:a.disk,files:a.files,server:withFrame()});
  assert.equal(currentFrame(b).id,'local-frame-two');b.time.advance(0);await flush();
  b.calls[0].reject({body:{error:'daily_limit_reached'}});await flush();assert.equal(currentFrame(b).id,'frame-new');
});

test('Love Note store accepts locally before network and retries paired durable request after navigation/relaunch',async()=>{
  const a=harness();await a.api.refreshBurrow();a.api.enqueueLoveNote(a.data,'Love you','note-key');
  assert.equal(a.commands.length,0);assert.equal(JSON.parse(a.disk.get('love-note-outbox:A'))[0].body,'Love you');
  a.time.advance(0);await flush();const first=a.commands[0];
  assert.equal(first.payload.action,'save_memory_durable');assert.equal(first.payload.actorId,'A');assert.equal(first.payload.partnerId,'B');
  assert.equal(first.payload.pairVersion,'pair');assert.equal(first.payload.body,'💌 Love you');assert.equal(first.payload.idempotencyKey,'note-key');
  first.reject(Error('offline'));await flush();assert.equal(a.notices.length,0);a.app('background');
  const b=harness({disk:a.disk,files:a.files});b.time.advance(0);await flush();assert.deepEqual(plain(b.commands[0].payload),plain(first.payload));
  b.commands[0].resolve({success:true});await flush();assert.deepEqual(JSON.parse(b.disk.get('love-note-outbox:A')),[]);
});
test('Love Note rejection preserves words for recovery, never overwrites a newer composer draft and account switch aborts requests',async()=>{
  const h=harness();await h.api.refreshBurrow();h.api.enqueueLoveNote(h.data,'Kept words','note-key');h.time.advance(0);await flush();
  h.commands[0].reject({body:{error:'feature_disabled'}});await flush();assert.equal(h.notices.length,1);
  assert.equal(h.api.recoverLoveNote(h.data).body,'Kept words');
  h.api.enqueueLoveNote(h.data,'Kept words','new-composer-key');h.time.advance(0);await flush();assert.equal(h.commands[1].payload.idempotencyKey,'note-key');
  h.api.enqueueLoveNote(h.data,'Kept words','new-composer-key');assert.equal(JSON.parse(h.disk.get('love-note-outbox:A')).length,1,'a draft cleanup retry must not duplicate the recovered send');
  const signal=h.commands[1].options.signal;h.identity('C');assert.equal(signal.aborted,true);
  h.commands[1].resolve({success:true});await flush();assert.equal(h.data,null);
});
test('solo Love Note remains a private Save with existing route and immediate durable local acceptance',async()=>{
  const data={...initial(),partner:null,pairVersion:undefined};const h=harness({server:data});await h.api.refreshBurrow();
  h.api.enqueueLoveNote(h.data,'For later','solo-note');assert.equal(h.commands.length,0);h.time.advance(0);await flush();
  assert.equal(h.commands[0].payload.action,'save_memory');assert.equal(h.commands[0].payload.body,'💌 For later');
  h.commands[0].resolve({success:true});await flush();assert.deepEqual(JSON.parse(h.disk.get('love-note-outbox:A')),[]);
});
test('receiving a grouped affection hides only the tap snapshot during slow acknowledgement and stale bootstrap reads',async()=>{
 const base={...initial(),unread:{affection:3,gifts:0},affectionInbox:[{id:'one',affection_type:'cuddle',completed_at:'2026-10-23'}],
  affectionInboxGroups:[{affection_type:'cuddle',completed_at:'2026-10-23',ids:['one','two','three']}]};
 const h=harness({server:base});await h.api.refreshBurrow();h.api.receiveBurrowAffectionLocally(['one','two','three']);
 assert.equal(h.data.affectionInboxGroups.length,0);assert.equal(h.data.unread.affection,0);
 await h.api.refreshBurrow({silent:true});assert.equal(h.data.affectionInboxGroups.length,0,'unacknowledged old IDs cannot reappear from a stale read');
 h.server({...base,unread:{affection:4,gifts:0},affectionInboxGroups:[{...base.affectionInboxGroups[0],ids:['one','two','three','new']}]});
 await h.api.refreshBurrow({silent:true});assert.deepEqual(plain(h.data.affectionInboxGroups[0].ids),['new']);assert.equal(h.data.unread.affection,1);
 h.api.confirmReceivedAffections(['one','two','three'],false);await h.api.refreshBurrow({silent:true});
 assert.equal(h.data.affectionInboxGroups[0].ids.length,4,'a confirmed failure remains recoverable');
});
