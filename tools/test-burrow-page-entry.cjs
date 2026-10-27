const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {load,deferred,flush,clock,hooks}=require('./lifecycle-test-utils.cjs');
function harness(){
  const time=clock(),opens=[],calls=[],identity=[];
  let data={catalogComplete:true,pairAccessVerified:true,profile:{id:'me',timezone_name:'UTC'},partner:{id:'you'},pairVersion:'one',hasPlus:false},epoch=1,owner='me';
  let refresh=async()=>{},release=null,overview=null,history=null,session=null,local=null;
  let visitReady=true,visitRead=async()=>{visitReady=true;},artReady=true,artRead=async()=>{};
  let releaseRead=async()=>{release={monsters:[{partnerTamedCount:0}]};},gameRead=async()=>({games:[{id:'a'}],ownedIds:['a']}),sessionRead=async()=>({id:'round'});
  const api=load('apps/mobile/src/lib/burrow-page-entry.ts',{
    'expo-router':{router:{push:path=>opens.push(path)}},
    './burrow-store':{getBurrowSnapshot:()=>({data}),refreshBurrow:async()=>{calls.push('bootstrap');await refresh();}},
    './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=>owner,subscribeSessionIdentity:fn=>identity.push(fn)},
    './async-lifecycle':load('apps/mobile/src/lib/async-lifecycle.ts',{},time.globals),
    './release-room-api':{releaseRoomScope:d=>`${d.profile.id}:${d.partner?.id??''}:${d.pairVersion??''}`,cachedReleaseRoom:()=>release,fetchReleaseRoom:async()=>{calls.push('release');await releaseRead();}},
    './burrow-game-room-api':{gameOverview:async()=>{calls.push('game');return gameRead();},gameSession:async()=>{calls.push('session');return sessionRead();},gameHistory:async()=>{calls.push('history');return {rounds:[]};}},
    './burrow-game-room-cache':{getCachedGameOverview:()=>overview,cacheGameOverview:v=>overview=v,getCachedGameSession:()=>session,cacheGameSession:v=>session=v,
      getCachedGameHistory:()=>history,cacheGameHistory:v=>history=v},
    './burrow-game-local':{readLocalGame:()=>local,reconcileLocalGame:value=>value},
    './burrow-page-art':{burrowPageArtReady:()=>artReady,warmBurrowPageArt:async()=>{calls.push('art');await artRead();}},
    './friend-visit-local':{friendVisitReady:()=>visitReady,warmFriendVisit:async()=>{calls.push('visit');await visitRead();}},
  },{...time.globals,URLSearchParams});
  return {api,time,opens,calls,get data(){return data;},set data(v){data=v;},set refresh(v){refresh=v;},set releaseRead(v){releaseRead=v;},set gameRead(v){gameRead=v;},set sessionRead(v){sessionRead=v;},
    set release(v){release=v;},set overview(v){overview=v;},set session(v){session=v;},set local(v){local=v;},get overview(){return overview;},
    set visitReady(v){visitReady=v;},set visitRead(v){visitRead=v;},
    set artReady(v){artReady=v;},set artRead(v){artRead=v;},
    start:entry=>api.enterBurrowPage(entry??{},()=>opens.push('opened')),identity(){epoch++;owner='other';identity.forEach(fn=>fn());}};
}
test('session-verified cache opens synchronously without a request or loading surface',()=>{
  const h=harness();h.start();assert.deepEqual(h.opens,['opened']);assert.deepEqual(h.calls,[]);assert.equal(h.api.getBurrowPageEntry().pending,false);
});
test('ready navigation supersedes an unrelated pending read and fences its eventual jump',async()=>{
  const h=harness(),read=deferred();h.visitReady=false;h.visitRead=async()=>{await read.promise;h.visitReady=true;};
  h.start({kind:'visit',intent:'friends'});await flush();assert.equal(h.api.getBurrowPageEntry().pending,true);
  h.start({kind:'shop',intent:'tab:shop'});assert.deepEqual(h.opens,['opened']);assert.equal(h.api.getBurrowPageEntry().pending,false);
  read.resolve();await flush();assert.equal(h.opens.length,1,'the old read may cache but never navigate');
});
test('a failed other destination cannot block a ready tab, and a different cold intent supersedes it',async()=>{
  for(const ready of [true,false]){
    const h=harness();h.visitReady=false;h.visitRead=async()=>{throw Error('offline');};h.start({kind:'visit'});await flush();
    assert.equal(h.api.getBurrowPageEntry().error,true);
    if(ready)h.start({kind:'shop'});else h.start({kind:'release'});
    await flush();assert.deepEqual(h.opens,['opened']);assert.equal(h.api.getBurrowPageEntry().error,false);
  }
});
test('distinct unready intents replace one another; only the latest can open and duplicate taps still coalesce',async()=>{
  const h=harness(),visit=deferred(),release=deferred();h.visitReady=false;h.visitRead=()=>visit.promise;
  h.releaseRead=async()=>{await release.promise;h.release={monsters:[{partnerTamedCount:0}]};};
  h.start({kind:'visit'});h.start({kind:'release'});h.start({kind:'release'});await flush();
  assert.deepEqual(h.calls,['visit','release']);visit.resolve();await flush();assert.equal(h.opens.length,0);
  release.resolve();await flush();assert.deepEqual(h.opens,['opened']);
});
test('quiet Memories Room retains instant offline drafting; notification preparation must not add a fetch to an empty prompt',()=>{
 const h=harness();h.start({kind:'journal'});assert.deepEqual(h.opens,['opened']);assert.deepEqual(h.calls,[]);
});
test('evicted display art cannot block an authorized cached page or turn a decode failure into a navigation error',async()=>{
 const h=harness(),decode=deferred();h.artReady=false;h.artRead=()=>decode.promise;
 h.start({kind:'shop'});assert.deepEqual(h.opens,['opened']);assert.equal(h.api.getBurrowPageEntry().pending,false);
 await flush();assert.deepEqual(h.calls,['art']);decode.reject(Error('decode failed'));await flush();
 assert.equal(h.api.getBurrowPageEntry().error,false);assert.equal(h.opens.length,1);
});
test('Friends Room preloads branches and art on the source; prepared visitors open without waiting',async()=>{
  const h=harness(),pending=deferred();h.data.pairAccessVerified=true;h.visitReady=false;
  h.visitRead=async()=>{await pending.promise;h.visitReady=true;};h.start({kind:'visit'});await flush();
  assert.equal(h.opens.length,0);assert.deepEqual(h.calls,['visit']);pending.resolve();await flush();
  assert.deepEqual(h.opens,['opened']);h.start({kind:'visit'});assert.equal(h.opens.length,2);assert.equal(h.calls.length,1);
});
test('cold catalogue waits on the SOURCE page and duplicate taps cannot start multiple navigations',async()=>{
  const h=harness(),read=deferred();delete h.data.catalogComplete;h.refresh=()=>read.promise;
  h.start();h.start();assert.equal(h.api.getBurrowPageEntry().pending,true);assert.equal(h.opens.length,0);assert.deepEqual(h.calls,['bootstrap']);
  h.data.catalogComplete=true;read.resolve();await flush();assert.deepEqual(h.opens,['opened']);assert.equal(h.api.getBurrowPageEntry().pending,false);
});
test('failure never opens a partial page; explicit Retry only navigates after a complete bootstrap',async()=>{
  const h=harness();delete h.data.catalogComplete;h.start();await flush();assert.equal(h.api.getBurrowPageEntry().error,true);assert.equal(h.opens.length,0);
  h.refresh=async()=>{h.data.catalogComplete=true;};h.api.retryBurrowPageEntry();await flush();assert.deepEqual(h.opens,['opened']);assert.equal(h.api.getBurrowPageEntry().error,false);
});
for(const reason of ['cancel','identity','timeout'])test(`${reason} fences late requests so they cannot unexpectedly open a page`,async()=>{
  const h=harness(),read=deferred();delete h.data.catalogComplete;h.refresh=()=>read.promise;h.start();
  if(reason==='cancel')h.api.cancelBurrowPageEntry();else if(reason==='identity')h.identity();else h.time.advance(15000);
  h.data.catalogComplete=true;read.resolve();await flush();assert.equal(h.opens.length,0);
  assert.equal(h.api.getBurrowPageEntry().error,reason==='timeout');
});
test('a pair change during preparation cancels the original relationship entry',async()=>{
  const h=harness(),read=deferred();delete h.data.catalogComplete;h.refresh=()=>read.promise;h.start();h.data={...h.data,catalogComplete:true,partner:{id:'new'},pairVersion:'two'};
  read.resolve();await flush();assert.equal(h.opens.length,0);assert.equal(h.api.getBurrowPageEntry().pending,false);
});
test('a snapshot belonging to another account is not a ready cache',async()=>{
  const h=harness();h.data.profile.id='other';h.start();await flush();assert.equal(h.opens.length,0);assert.equal(h.api.getBurrowPageEntry().error,true);
});
test('public cached displays open immediately but partner-private pages require current authorization',async()=>{
 const h=harness();h.start();assert.deepEqual(h.opens,['opened']);
 h.data.pairAccessVerified=false;
 h.api.cancelBurrowPageEntry();const read=deferred();h.refresh=()=>read.promise;
 h.start({kind:'private'});assert.equal(h.opens.length,1);assert.deepEqual(h.calls,['bootstrap']);
 h.data.pairAccessVerified=true;read.resolve();await flush();assert.equal(h.opens.length,2);
});
test('Release waits for real partner statistics and daily quota, not disk-only null placeholders',async()=>{
  const h=harness(),read=deferred();h.release={monsters:[{partnerTamedCount:null}]};h.releaseRead=async()=>{await read.promise;h.release={monsters:[{partnerTamedCount:4}]};};
  h.start({kind:'release'});await flush();assert.equal(h.opens.length,0);assert.deepEqual(h.calls,['release']);read.resolve();await flush();assert.deepEqual(h.opens,['opened']);
  h.api.cancelBurrowPageEntry();h.start({kind:'release'});assert.equal(h.calls.length,1,'warm quota never incurs another entry wait');
});
test('Game waits for shared unlock state and requested round together; no purchase or mutation runs',async()=>{
  const h=harness(),game=deferred(),session=deferred();h.gameRead=()=>game.promise;h.sessionRead=()=>session.promise;
  h.start({kind:'game',sessionId:'round'});await flush();assert.deepEqual(h.calls,['game','session']);game.resolve({games:[{id:'a'}],ownedIds:['a']});await flush();assert.equal(h.opens.length,0);
  session.resolve({id:'round'});await flush();assert.deepEqual(h.opens,['opened']);
});
test('background Game warmup and first click coalesce; ready cached local round opens immediately',async()=>{
  const h=harness(),read=deferred();h.gameRead=()=>read.promise;
  const warm=h.api.warmBurrowGameOverview();h.start({kind:'game'});assert.deepEqual(h.calls,['game']);read.resolve({games:[{id:'a'}],ownedIds:[]});await warm;await flush();assert.deepEqual(h.opens,['opened']);
  h.local={session:{id:'local:one'}};h.start({kind:'game',sessionId:'local:one'});assert.equal(h.opens.length,2);assert.deepEqual(h.calls,['game']);
});
test('Game history entry prepares history before navigation; failed prewarm remains retryable',async()=>{
  const h=harness();h.gameRead=async()=>{throw Error('network');};await assert.rejects(h.api.warmBurrowGameOverview());
  h.gameRead=async()=>({games:[{id:'a'}],ownedIds:[]});h.start({kind:'game',history:true});await flush();assert.deepEqual(h.opens,['opened']);assert.deepEqual(h.calls,['game','game','history']);
});
test('optional lobby warmup reuses its prepared revision but refreshes for catalogue, tier and account changes',async()=>{
  const h=harness();await h.api.warmBurrowGameOverview();
  for(let i=0;i<20;i++)await h.api.warmBurrowGameOverview();assert.equal(h.calls.length,1);
  h.data={...h.data,wallet:{balance:900},serverNow:'later'};await h.api.warmBurrowGameOverview();assert.equal(h.calls.length,1);
  h.data={...h.data,catalog:[]};await h.api.warmBurrowGameOverview();assert.equal(h.calls.length,2);
  h.data={...h.data,hasPlus:true};await h.api.warmBurrowGameOverview();assert.equal(h.calls.length,3);
  h.identity();h.data={...h.data,profile:{...h.data.profile,id:'other'}};await h.api.warmBurrowGameOverview();assert.equal(h.calls.length,4);
});
test('prepared stack entry retains route params and chooses Game or Release readiness',async()=>{
  const h=harness();const path={pathname:'/(main)/game-room',params:{sessionId:'round',source:'history'}};h.api.openPreparedBurrow(path);await flush();assert.equal(h.opens[0],path);assert.deepEqual(h.calls,['game','session']);
  const q=harness();q.api.openPreparedBurrow('/(main)/tame-enemy?monsterId=anxiety');await flush();assert.deepEqual(q.calls,['release']);assert.equal(q.opens.length,1);
});
test('rules-only game entry preloads an unfinished round without turning it into a direct session route',async()=>{
  for(const path of [{pathname:'/(main)/game-room',params:{gameId:'a',resumeSessionId:'round'}},'/(main)/game-room?gameId=a&resumeSessionId=round']){
    const h=harness(),read=deferred();h.sessionRead=()=>read.promise;
    h.api.openPreparedBurrow(path);await flush();assert.deepEqual(h.calls,['game','session']);assert.equal(h.opens.length,0);
    read.resolve({id:'round'});await flush();assert.equal(h.opens[0],path);
  }
});
for(const platform of ['ios','android'])test(`${platform}: entry spinner covers the source; Retry is bounded, Cancel/background/route changes cancel`,()=>{
  const h=hooks(),callbacks=[],jsx=(type,props)=>({type,props});let state={pending:true,error:false},cancel=0,params={};
  const {BurrowPageEntryOverlay}=load('apps/mobile/src/components/burrow/burrow-page-entry-overlay.tsx',{
    react:{...h.react,useSyncExternalStore:(_s,get)=>get()},'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{Platform:{OS:platform},ActivityIndicator:'Spinner',Pressable:'Button',StyleSheet:{create:x=>x},Text:'Text',View:'View',AppState:{addEventListener:(_e,fn)=>{callbacks.push(fn);return{remove(){}};}}},
    'expo-router':{usePathname:()=>'/home',useGlobalSearchParams:()=>params},'@/components/ui/screen-overlay':{ScreenOverlay:'Overlay'},
    '@/lib/burrow-page-entry':{getBurrowPageEntry:()=>state,subscribeBurrowPageEntry(){},cancelBurrowPageEntry:()=>cancel++,retryBurrowPageEntry(){}},
  });
  const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
  let tree=h.render(BurrowPageEntryOverlay);assert.equal(tree.type,'Overlay');assert.ok(nodes(tree).some(n=>n.type==='Spinner'));
  callbacks[0]('background');assert.equal(cancel,1);state={pending:false,error:true};tree=h.render(BurrowPageEntryOverlay);
  const retry=nodes(tree).find(n=>n.type==='Button'&&n.props.children.props.children==='Retry');assert.ok(retry);assert.equal(retry.props.style.flexGrow,undefined);assert.equal(retry.props.style.minHeight,48);
  tree.props.onRequestClose();assert.equal(cancel,2);
  params={sessionId:'another-round'};h.render(BurrowPageEntryOverlay);assert.equal(cancel,3,'same path but new route params cancel the old intent');
  h.unmount();assert.equal(cancel,4);
});
test('all primary entrances use the shared readiness gate, without changing the retained navigator',()=>{
  const screen=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8'),bar=fs.readFileSync('apps/mobile/src/components/main/bottom-tab-bar.tsx','utf8');
  assert.match(screen,/else enterBurrowPage\(entry,dispatch\)/);assert.match(bar,/enterBurrowPage\(\{kind:routeName==='shop'\?'shop':routeName==='friends'\?'private':'page',intent:`tab:\$\{routeName\}`\}/);
  assert.match(screen,/id==='rage_room'\)openPreparedBurrow/);assert.match(screen,/id==='surprise_room'\)openPreparedBurrow/);
  const loadStyle=screen.slice(screen.indexOf("if((section==='shop'||section==='decorate')"),screen.indexOf("if((section==='shop'||section==='decorate')")+650);
  assert.match(loadStyle,/width:180/);assert.ok(!loadStyle.includes('<Action label="Retry"')||loadStyle.includes('<View style={{width:180}}>'));
});
test('Home envelope and care permissions use the newly prepared snapshot, never a captured disk snapshot',()=>{
  const ts=require('typescript'),vm=require('node:vm'),source=fs.readFileSync('apps/mobile/src/components/burrow/burrow-screen.tsx','utf8');
  const ast=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
  function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='openHomeInteraction')expression=n.initializer.getText(ast);ts.forEachChild(n,visit);}visit(ast);
  const code=ts.transpileModule(`const openHomeInteraction=${expression};exports.open=openHomeInteraction;`,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={},opens=[],permissions=[],care=[];let ready=false,pending,data={partner:null};
  vm.runInNewContext(code,{exports,burrowPageIsReady:()=>ready,enterBurrowPage:(_entry,open)=>pending=open,getBurrowSnapshot:()=>({data}),
    requirePartner:current=>{permissions.push(current);return !current.partner;},careCoolingDown:current=>{care.push(current);return false;},openPreparedBurrow:path=>opens.push(path),setCareStatus(){}});
  exports.open('letter');assert.equal(opens.length,0);assert.equal(permissions.length,0,'cached unpaired state cannot open the wrong invitation');
  data={partner:{id:'newly-paired'}};ready=true;pending();assert.equal(opens.length,1);assert.equal(permissions[0],data);
  exports.open('food');assert.equal(care[0],data);assert.equal(opens.length,2);
});
