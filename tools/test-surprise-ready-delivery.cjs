const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',ID='33333333-3333-4333-8333-333333333333',PAIR='a'.repeat(32),SCOPE=`${A}:${B}:${PAIR}`;
const plain=x=>JSON.parse(JSON.stringify(x));
function cacheHarness({disk=new Map(),files=new Map(),download}={}){
 let epoch=1,sequence=0,identity;const timer=clock(),fetches=[],copies=[];
 const fs={getInfoAsync:async uri=>files.has(uri)?{exists:true,isDirectory:false,size:files.get(uri)}:{exists:false},
  makeDirectoryAsync:async()=>{},copyAsync:async({from,to})=>{assert.ok(files.has(from),from);files.set(to,files.get(from));copies.push([from,to]);},
  moveAsync:async({from,to})=>{assert.ok(files.has(from));files.set(to,files.get(from));files.delete(from);},
  deleteAsync:async uri=>{files.delete(uri);},readDirectoryAsync:async dir=>[...files.keys()].filter(x=>x.startsWith(dir)).map(x=>x.slice(dir.length)),
  downloadAsync:async(url,to)=>{fetches.push(url);if(download)await download();files.set(to,100);return{status:200};}};
 fs.FileSystemSessionType={BACKGROUND:0};fs.createDownloadResumable=(url,to)=>({downloadAsync:()=>fs.downloadAsync(url,to),cancelAsync:async()=>{}});
 const api=load('apps/mobile/src/lib/surprise-media-cache.ts',{'expo-file-system/legacy':fs,'expo-crypto':{randomUUID:()=>String(++sequence)},
  './storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v),remove:k=>disk.delete(k)}},
  '@/shared/storage/keys':{kSurpriseMedia:{keyFor:s=>'index:'+s}},
  '@/shared/storage/artifacts':{SURPRISE_MEDIA_DIRECTORY:'doc/',SURPRISE_LEGACY_MEDIA_DIRECTORY:'cache/',waitForSurpriseCleanup:async()=>{}},
  './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}},'./async-lifecycle':{withDeadline:p=>p},
 },timer.globals);
 return {...api,files,disk,fetches,copies,timer,switchAccount(){epoch++;identity();}};
}
test('sender originals become durable replay media; restart and replay need no network or re-download',async()=>{
 const c=cacheHarness();c.files.set('draft/face',75);c.files.set('draft/audio',125);
 await c.keepSentSurpriseMedia(A,PAIR,ID,'draft/face','draft/audio');
 const restarted=cacheHarness(c);let authorizations=0;
 const media=await restarted.resolveSurpriseMedia(A,PAIR,ID,async()=>{authorizations++;throw Error('offline');});
 assert.equal(media.photoUrl,`doc/${A}-${PAIR}-${ID}.jpg`);assert.equal(authorizations,0);assert.equal(c.fetches.length,0);
});
test('concurrent preloads share one authorization/download; incomplete pairs redownload safely',async()=>{
 const pending=deferred(),c=cacheHarness({download:()=>pending.promise});let authorizations=0;
 const links=async()=>{authorizations++;return{photoUrl:'private-face',audioUrl:'private-audio'};};
 const first=c.resolveSurpriseMedia(A,PAIR,ID,links),second=c.resolveSurpriseMedia(A,PAIR,ID,links);assert.equal(first,second);
 await flush();pending.resolve();const media=await first;assert.equal(authorizations,1);assert.equal(c.fetches.length,2);
 c.files.delete(media.audioUrl);await c.resolveSurpriseMedia(A,PAIR,ID,links);assert.equal(authorizations,2);
 assert.ok([...c.disk.values()].every(x=>!x.includes('private-face')&&!x.includes('private-audio')));
});
test('legacy temporary files are promoted without losing history or requiring a second download',async()=>{
 const c=cacheHarness();const prefix=`cache/${A}-${PAIR}-${ID}`;c.files.set(prefix+'.jpg',12);c.files.set(prefix+'.m4a',24);
 await c.resolveSurpriseMedia(A,PAIR,ID,async()=>{throw Error('No network allowed');});assert.equal(c.copies.length,2);
});
test('byte-budget LRU removes whole pairs, respects recent access and pins currently playing media',async()=>{
 const c=cacheHarness();c.files.set('photo',35*1024*1024);c.files.set('voice',35*1024*1024);
 const next='44444444-4444-4444-8444-444444444444';const unpin=c.pinSurpriseMedia(A,PAIR,ID);
 await c.keepSentSurpriseMedia(A,PAIR,ID,'photo','voice');c.timer.advance(1);
 await c.keepSentSurpriseMedia(A,PAIR,next,'photo','voice');assert.ok(c.cachedSurpriseMedia(A,PAIR,ID));
 unpin();const third='55555555-5555-4555-8555-555555555555';c.timer.advance(1);await c.keepSentSurpriseMedia(A,PAIR,third,'photo','voice');
 assert.equal(c.cachedSurpriseMedia(A,PAIR,ID),null);assert.equal(c.cachedSurpriseMedia(A,PAIR,next),null);
 assert.ok(![...c.files.keys()].some(uri=>uri.startsWith(`doc/${A}-${PAIR}-${ID}`)));
});
for(const cause of ['account','unpair'])test('late downloads cannot publish or retain media after '+cause,async()=>{
 const pending=deferred(),c=cacheHarness({download:()=>pending.promise});
 const work=c.resolveSurpriseMedia(A,PAIR,ID,async()=>({photoUrl:'face',audioUrl:'audio'}));await flush();
 if(cause==='account')c.switchAccount();else await c.clearSurpriseMediaScope(A,PAIR);
 pending.resolve();await assert.rejects(work);await flush();assert.equal(c.cachedSurpriseMedia(A,PAIR,ID),null);assert.ok(![...c.files.keys()].some(uri=>uri.startsWith('doc/')));
});

function gateHarness(){
 const h=hooks(),timer=clock(),pending=deferred();let ready=false,entryPending=true,home=true,overlay=false,scope='',warmups=0;
 const item={id:ID,sender_id:B,recipient_id:A,frame:'santa',duration_ms:2000,sent_at:'2026-10-16T00:00:00Z',opened_at:null};
 const data={profile:{id:A},partner:{id:B},pairVersion:PAIR,pairAccessVerified:true,catalogComplete:true};
 const media={photoUrl:'doc/face',audioUrl:'doc/audio'},navigation=[],contexts=[];
 const jsx=(type,props)=>({type,props});
 const module=load('apps/mobile/src/components/burrow/surprise-arrival-gate.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},Pressable:'Button',StyleSheet:{create:x=>x},Text:'Text',View:'View'},
  'expo-router':{router:{push:href=>navigation.push(href)},useSegments:()=>home?['(main)','(tabs)']:['(main)','game-room']},'@expo/vector-icons':{Feather:'Icon'},
  '@/lib/burrow-store':{useBurrowSnapshot:()=>({data,busy:false})},'@/lib/use-major-update':{useMajorUpdateEnabled:()=>true},
  '@/lib/surprise-inbox':{useSurpriseInbox:()=>[item],refreshSurpriseInbox:async()=>{},subscribeSurpriseRefresh:()=>()=>{}},
  '@/lib/surprise-preparation':{SURPRISE_STARTUP_WINDOW_MS:5000,useSurprisePreparation:()=>ready?1:0,setSurprisePreparationScope:s=>{scope=s;},
   preparedSurprise:(s,id)=>ready&&s===scope&&id===ID?{item,media}:undefined,prepareSurprise:()=>{warmups++;return pending.promise.then(()=>{ready=true;});}},
  '@/lib/surprise-send-queue':{setSurpriseDeliveryContext:c=>contexts.push(c),resumeSurpriseOutbox:async()=>{}},
  '@/lib/use-home-entry':{useHomeEntry:()=>({pending:entryPending})},
  '@/lib/overlay-presence':{useOverlayPresent:()=>overlay,registerOverlay:()=>()=>{}},
  '@/lib/async-lifecycle':load('apps/mobile/src/lib/async-lifecycle.ts',{},timer.globals),
  '@/components/ui/screen-overlay':{ScreenOverlay:'Overlay'},'./surprise-art':{SurpriseGift:'Gift',SurprisePortrait:'Portrait'},
  './surprise-composer-ui':{SurpriseAction:'Action',SurpriseCard:'Card',SurpriseGiftbox:'Gift'},
 },{...timer.globals,setInterval:timer.globals.setTimeout,clearInterval:timer.globals.clearTimeout});
 const render=()=>h.render(()=>module.SurpriseArrivalGate());
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 return {h,timer,render,ready:async()=>{pending.resolve();await flush();},warmups:()=>warmups,navigation,contexts,
  enterHome:()=>{entryPending=false;home=true;},away:()=>{entryPending=false;home=false;},otherOverlay:v=>{overlay=v;},
  receive:tree=>nodes(tree).find(n=>n.type==='Action'&&n.props.title==='Open')};
}
test('startup preloads under the cover; five-second soft timeout neither cancels download nor blocks Home',async()=>{
 const g=gateHarness();assert.equal(g.render().props.visible,false);assert.ok(g.warmups()>0);
 g.timer.advance(5001);await flush();g.enterHome();assert.equal(g.render().props.visible,false);
 await g.ready();g.render();let tree=g.render();assert.equal(tree.props.visible,true);
 const tap=g.receive(tree).props.onPress;tap();tap();assert.equal(g.navigation.length,1);g.h.unmount();
});
test('completed startup preload waits for returning Home and for other overlays to close',async()=>{
 const g=gateHarness();g.render();g.away();await g.ready();assert.equal(g.render().props.visible,false);
 g.enterHome();g.otherOverlay(true);g.render();assert.equal(g.render().props.visible,false);
 g.otherOverlay(false);g.render();assert.equal(g.render().props.visible,true);g.h.unmount();
});
test('ready arrival can only be opened, not dismissed with Back or an accidental background tap',async()=>{
 const g=gateHarness();g.render();await g.ready();g.enterHome();g.render();let tree=g.render();assert.equal(tree.props.visible,true);
 tree.props.onRequestClose();tree=g.render();assert.equal(tree.props.visible,true);assert.ok(g.receive(tree));g.h.unmount();
});

function preparationHarness(){
 const timer=clock(),pending=deferred(),cleared=[],invalidated=[],decoded=[];let epoch=1,identity,loads=0,released=0;
 const api=load('apps/mobile/src/lib/surprise-preparation.ts',{
  react:{useSyncExternalStore:(_subscribe,get)=>get()},'expo-audio':{createAudioPlayer:()=>({duration:2,isLoaded:true,addListener:()=>({remove(){}}),remove(){released++;}})},
  './surprise-api':{loadSurpriseMedia:async()=>{loads++;await pending.promise;return{photoUrl:'photo.jpg',audioUrl:'voice.m4a'};}},
  './session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}},
  './prepared-burrow-images':{prepareBurrowImages:async sources=>decoded.push(sources)},'./surprise-frame-assets':{SURPRISE_FRAME_OPTIONS:[{id:'santa',source:1}]},
  './surprise-media-cache':{clearSurpriseMediaScope:async(...args)=>cleared.push(args),invalidateSurpriseMedia:async(...args)=>invalidated.push(args),pinSurpriseMedia:()=>()=>{},rememberSurprisePortrait:async()=>{}},
  './surprise-portrait-renderer':{renderSurprisePortrait:async()=> 'portrait.png'},
 },timer.globals);
 api.setSurprisePreparationScope(SCOPE);
 return{...api,pending,timer,cleared,invalidated,decoded,loads:()=>loads,released:()=>released,signOut(){epoch++;identity();}};
}
test('actual readiness deduplicates work and waits for decoded audio/composite, then serves repeated opens without I/O',async()=>{
 const p=preparationHarness(),item={id:ID,frame:'santa'},first=p.prepareSurprise(SCOPE,item),second=p.prepareSurprise(SCOPE,item);
 assert.equal(first,second);p.timer.advance(5001);assert.equal(p.preparedSurprise(SCOPE,ID),undefined);p.pending.resolve();await first;
 assert.equal(p.loads(),1);assert.equal(p.released(),0,'validation player stays warm for Receive');assert.equal(p.decoded[0][0].uri,'portrait.png');assert.equal(p.preparedSurprise(SCOPE,ID).media.portraitUri,'portrait.png');
 await p.prepareSurprise(SCOPE,item);assert.equal(p.loads(),1);
});
test('warm Receive audio is leased without recreation and retired only after its last native view releases',async()=>{
 const p=preparationHarness();p.pending.resolve();await p.prepareSurprise(SCOPE,{id:ID,frame:'santa'});
 const first=p.acquirePreparedSurpriseAudio(SCOPE,ID),second=p.acquirePreparedSurpriseAudio(SCOPE,ID);assert.ok(first);assert.equal(first.player,second.player);
 p.signOut();assert.equal(p.released(),0,'never invalidate an active view shared object');assert.equal(p.acquirePreparedSurpriseAudio(SCOPE,ID),undefined);
 first.release();assert.equal(p.released(),0);second.release();second.release();assert.equal(p.released(),1,'remove once after every view unsubscribes');
});
for(const cause of ['pair','account'])test('late preparation never publishes an old gift after '+cause+' changes',async()=>{
 const p=preparationHarness(),work=p.prepareSurprise(SCOPE,{id:ID,frame:'santa'});
 if(cause==='pair')p.setSurprisePreparationScope(`${A}:${B}:${'b'.repeat(32)}`);else p.signOut();p.pending.resolve();
 await assert.rejects(work,/pair_changed/);assert.equal(p.preparedSurprise(SCOPE,ID),undefined);
 if(cause==='pair')assert.deepEqual(p.cleared[0],[A,PAIR]);
});
