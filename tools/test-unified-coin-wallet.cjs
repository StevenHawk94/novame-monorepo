const {test}=require('node:test'),assert=require('node:assert/strict');
const {load,hooks,clock,deferred,flush}=require('./lifecycle-test-utils.cjs');
const {motionHarness,model:motion}=require('./motion-test-utils.cjs');
const ledgerModel=load('apps/mobile/src/lib/coin-reward-ledger.ts');
const layout=load('apps/mobile/src/lib/coin-wallet-layout.ts',{'./burrow-motion':motion});
const queueModel=load('apps/mobile/src/lib/coin-operation-queue.ts');
const wallet=(balance=100,version=1,credits=[])=>({wallet:{balance,version},credits:credits.map(([key,amount])=>({key,amount})),localDate:'2026-10-17',timezone:'UTC',serverNow:'2026-10-17T12:00:00Z'});
function storeHarness(){const time=clock();let epoch=1;const listeners=[];
 const api=load('apps/mobile/src/lib/coin-reward-store.ts',{'react':{useSyncExternalStore:(_,read)=>read()},
 './session-lifecycle':{sessionEpoch:()=>epoch,sessionUserId:()=> 'me',subscribeSessionIdentity:fn=>listeners.push(fn)},
 './coin-reward-ledger':ledgerModel,'./burrow-motion':motion},time.globals);
 api.syncCoinWallet(wallet().wallet,wallet());return{...api,time,change(){epoch++;listeners.forEach(fn=>fn());}};}
test('wallet width grows only with real digits, commas and minus signs; plus matches visible coin diameter',()=>{
 const widths=[9,99,999,9999,99999].map(n=>layout.coinWalletWidth(n));
 for(let i=1;i<widths.length;i++)assert.ok(widths[i]>widths[i-1]);
 assert.ok(layout.coinWalletWidth(9)<layout.coinWalletWidth(99999)-40);
 const m=layout.coinWalletMetrics();assert.equal(m.addSize/m.iconSize,.85);
 assert.ok(layout.coinNumberWidth(-20,18)>layout.coinNumberWidth(20,18));
 for(const n of [9,99,999,9999,99999,-99]){
  const center=m.padding+m.iconSize+m.gap+layout.coinNumberWidth(n,18)/2;
  assert.ok(Math.abs(center-layout.coinWalletWidth(n,18)/2)<1e-9,'equal side tracks center every number in the wallet');
 }
});
test('wallet face keeps equal icon tracks while its number is centered, without enlarging the orange disc',()=>{
 const jsx=(type,props)=>({type,props});
 const {CoinWalletFace}=load('apps/mobile/src/components/burrow/coin-wallet-face.tsx',{
  '@/lib/burrow-motion':motion,
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{Pressable:'Pressable',View:'View',StyleSheet:{create:x=>x}},
  './coin-ui':{CoinIcon:'Coin',CoinAddIcon:'Add'},'./animated-coin-balance':{AnimatedCoinBalance:'Number'},'@/lib/coin-wallet-layout':layout,
 });
 const face=CoinWalletFace({balance:1000,count:{value:1000},fontSize:18,onPress(){}}),[coin,number,plusTrack]=face.props.children.props.children;
 assert.equal(face.props.style({pressed:false})[0].height,48,'real touch bounds, not hitSlop clipped by a 31pt parent');
 assert.equal(coin.props.size,plusTrack.props.style.width);assert.equal(plusTrack.props.style.alignItems,'center');
 assert.equal(plusTrack.props.children.props.size,coin.props.size*.85);assert.equal(number.type,'Number');
 const compact=CoinWalletFace({balance:1000,count:{value:1000},fontSize:18,onPress(){},showAdd:false});
 assert.equal(compact.props.children.props.children.filter(Boolean).length,2,'compact wallet has no add button or empty trailing track');
 assert.equal(compact.props.children.props.children.at(-1),false);
 const metrics=layout.coinWalletMetrics(18);
 const compactStyle=compact.props.children.props.style[1];
 assert.equal(compactStyle.paddingHorizontal,metrics.padding,'same left/right padding after removing +');
 assert.equal(compactStyle.paddingRight,undefined,'no retained right-side + reservation');
 assert.ok(Math.abs(layout.coinWalletWidth(1000,18)-layout.coinWalletWidth(1000,18,false)-metrics.iconSize-metrics.gap)<1e-9);
});
test('wallet expands actual touch bounds while preserving flow height, visible top and particle anchor',()=>{
 const h=hooks(),jsx=(type,props)=>({type,props}),m=layout.coinWalletMetrics(18),anchors=[],notifications=[];
 const registry={useCoinWalletRegistry:()=>({portal:null}),registerCoinWallet:slot=>{anchors.push(slot);return()=>{};}};
 const {CoinWallet}=load('apps/mobile/src/components/burrow/coin-wallet.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',useWindowDimensions:()=>({width:390,height:844})},
  '@react-navigation/native':{useIsFocused:()=>true,useNavigation:()=>({addListener:()=>()=>{}})},
  '@/lib/coin-wallet-registry':registry,'@/lib/coin-wallet-layout':layout,'@/components/layout/adaptive-app-frame':{getAdaptiveFrameMetrics:()=>({width:390})},
  './coin-wallet-context':{useWalletMotion:()=>({balance:100,count:{value:100}})},'./coin-wallet-face':{CoinWalletFace:'Face'},
 });
 const tree=h.render(()=>CoinWallet({balance:100,fontSize:18,onPress(){},onAnchor:a=>notifications.push(a)}));
 const style=tree.props.style[0];assert.equal(style.height,48);assert.equal(style.height+2*style.marginVertical,m.height);
 tree.props.ref.current={measureInWindow:callback=>callback(10,20-m.touchInset,100,48)};tree.props.onLayout();
 assert.equal(anchors.at(-1).anchor.y,20);assert.equal(anchors.at(-1).anchor.height,m.height);assert.equal(notifications.at(-1).y,20);
 h.unmount();
});
test('deferred rewards never alter visible wallet before the scene beat; concurrent claims share the correct baseline',()=>{
 const h=storeHarness(),a=h.beginCoinReward('heart','heart',10,true);
 assert.equal(h.getCoinRewardSnapshot().balance,110);assert.equal(h.getCoinRewardSnapshot().displayBalance,100);
 h.settleCoinReward(a,{reward:10,coinState:wallet(110,2,[['heart',10]])});assert.equal(h.getCoinRewardSnapshot().displayBalance,100);
 const b=h.beginCoinReward('quest','quest',10);assert.equal(h.getCoinRewardSnapshot().batch.from,100);assert.equal(h.getCoinRewardSnapshot().displayBalance,110);
 h.settleCoinReward(b,{reward:10,coinState:wallet(120,3,[['heart',10],['quest',10]])});h.releaseCoinReward('heart');
 const state=h.getCoinRewardSnapshot();assert.equal(state.displayBalance,120);assert.equal(state.batch.from,100);assert.equal(state.batch.earned,20);
 h.releaseCoinReward('heart');assert.equal(h.getCoinRewardSnapshot().batch.earned,20);
});
test('promoting a plus-free wallet preserves its compact face and particle geometry',()=>{
 const h=hooks(),m=motionHarness(h),jsx=(type,props)=>({type,props}),portal={};
 const model={balance:1234,count:{value:1234},batch:null},slot={anchor:{x:220,y:25,width:90,height:35},fontSize:18,showAdd:false,onPress(){},disabled:false};
 const {CoinRewardSurface}=load('apps/mobile/src/components/burrow/coin-reward-banner.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{View:'View',Platform:{OS:'ios'},StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:320,height:568})},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:20})},'react-native-screens':{},'expo-router':{},
  'react-native-reanimated':m.reanimated,'./coin-ui':{},'./coin-wallet-face':{CoinWalletFace:'WalletFace'},
  './coin-wallet-context':{useWalletMotion:()=>model},'@/lib/coin-wallet-registry':{useCoinWalletRegistry:()=>({slot,portal})},
  '@/lib/coin-wallet-layout':layout,'@/lib/coin-reward-store':{},'@/lib/burrow-motion':motion,'@/lib/haptics':{},
  '@/components/layout/adaptive-app-frame':{getAdaptiveFrameMetrics:()=>({width:320})},
 });
 const tree=h.render(()=>CoinRewardSurface({portal})),face=tree.props.children[1].props.children;
 assert.equal(face.type,'WalletFace');assert.equal(face.props.showAdd,false);assert.equal(face.props.balance,1234);
 h.unmount();
});
for(const os of ['ios','android'])test(`${os}: seven prepared coin nodes stay invisible/touch-through when idle, retarget origins without remounting and yield to the real modal owner`,()=>{
 const h=hooks(),m=motionHarness(h),jsx=(type,props,key)=>({type,props,key});
 // Real useDerivedValue retains one shareable object; this identity check
 // must not use the legacy numeric harness's fresh getter on every render.
 m.reanimated.useDerivedValue=fn=>{const latest=h.react.useRef(fn);latest.current=fn;return h.react.useMemo(()=>({get value(){return latest.current();}}),[]);};
 const model={balance:100,count:{value:100},pulse:{value:1},elapsed:{value:0},batch:null,reduced:false};
 const registry={slot:null,portal:null};
 const api=load('apps/mobile/src/components/burrow/coin-reward-banner.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',Platform:{OS:os},StyleSheet:{create:x=>x,absoluteFill:{}},useWindowDimensions:()=>({width:390,height:844})},
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44})},'react-native-screens':{FullWindowOverlay:'WindowOverlay'},'expo-router':{},
  'react-native-reanimated':m.reanimated,'./coin-ui':{},'./coin-wallet-face':{CoinWalletFace:'WalletFace'},
  './coin-wallet-context':{useWalletMotion:()=>model},'@/lib/coin-wallet-registry':{useCoinWalletRegistry:()=>registry},
  '@/lib/coin-wallet-layout':layout,'@/lib/coin-reward-store':{},'@/lib/burrow-motion':motion,'@/lib/haptics':{},
 });
 const render=props=>h.render(()=>api.CoinRewardSurface(props??{}));
 const content=t=>t.type==='WindowOverlay'?t.props.children:t;
 let tree=content(render()),layer=tree.props.children[0],particles=layer.props.children;
 assert.equal(tree.props.pointerEvents,'box-none');assert.equal(layer.props.pointerEvents,'none');assert.equal(layer.props.style[1].opacity,0);
 assert.equal(layer.props.importantForAccessibility,'no-hide-descendants');assert.equal(particles.length,7);
 const hiddenWallet=tree.props.children[1];assert.equal(hiddenWallet.props.pointerEvents,'none');assert.equal(hiddenWallet.props.accessibilityElementsHidden,true);assert.equal(hiddenWallet.props.style[1].opacity,0);assert.equal(hiddenWallet.props.children.props.disabled,true);
 const origin=particles[0].props.preparedOrigin,target=particles[0].props.target;
 model.batch={id:1,flight:{id:1,origin:{x:20,y:30}}};tree=content(render());layer=tree.props.children[0];
 assert.equal(layer.props.style[1].opacity,1);assert.equal(layer.key,undefined);assert.equal(layer.props.children[0].props.preparedOrigin,origin);
 assert.equal(layer.props.children[0].props.target,target);assert.deepEqual(origin.value,{x:20,y:30});
 model.batch={id:2,flight:{id:2,origin:{x:80,y:90}}};tree=content(render());assert.equal(tree.props.children[0].props.children[0].props.preparedOrigin,origin);assert.deepEqual(origin.value,{x:80,y:90});
 model.batch=null;assert.equal(content(render()).props.children[0].props.style[1].opacity,0,'background/finished never freezes coins onscreen');
 registry.portal={};assert.equal(render(),null,'root yields to the modal rather than duplicating an overlay');
 assert.notEqual(render({portal:registry.portal}),null);model.balance=null;assert.equal(render({portal:registry.portal}),null,'identity revoked');h.unmount();
});
test('release before receipt is immediate, receipt retargets once; cap changes cannot create visible phantom coins',()=>{
 const h=storeHarness(),a=h.beginCoinReward('a','a',10,true);h.releaseCoinReward('a');const batch=h.getCoinRewardSnapshot().batch;
 h.settleCoinReward(a,{reward:5,coinReward:{key:'a',amount:5},coinState:wallet(105,2,[['a',5]])});
 assert.equal(h.getCoinRewardSnapshot().displayBalance,105);assert.equal(h.getCoinRewardSnapshot().batch.earned,5);assert.equal(h.getCoinRewardSnapshot().batch.celebration,batch.celebration);
 const l=new ledgerModel.CoinRewardLedger();l.sync(wallet(99980));l.begin('x','x',10);l.sync(wallet(99995,2,[['other',15]]));assert.equal(l.balance,99999);
 assert.equal(l.visibleBalance(new Map([['x',{key:'x',amount:10,released:false}]])),99995);
 l.sync(wallet(120000,3));assert.equal(l.balance,120000,'never truncate real purchase balances');
});
test('ambiguous timeout retains projection and definitive rejection removes only its own grant',()=>{
 const h=storeHarness(),a=h.beginCoinReward('a','a',10),b=h.beginCoinReward('b','b',15);
 h.failCoinReward(a,Error('Operation timed out'));assert.equal(h.getCoinRewardSnapshot().balance,125);
 h.failCoinReward(a,Error('invalid_response'));assert.equal(h.getCoinRewardSnapshot().balance,125,'a malformed receipt is not proof that the server rejected a grant');
 h.failCoinReward(b,Error('plus_required'));assert.equal(h.getCoinRewardSnapshot().balance,110);
 h.settleCoinReward(a,{applied:false,reward:0,coinReward:{key:'a',amount:0},coinState:wallet(110,2,[['a',10]])});assert.equal(h.getCoinRewardSnapshot().balance,110);
});
function queueHarness(disk=[]){let owner='me',active=true,rows=disk;const calls=[],events=[],requests=[],time=clock();
 const q=queueModel.createCoinOperationQueue({owner:()=>owner,active:()=>active,load:()=>rows,save:r=>{rows=JSON.parse(JSON.stringify(r));},
  project:(r,quiet)=>events.push(['project',r.id,quiet]),send:r=>{calls.push(JSON.parse(JSON.stringify(r)));const d=deferred();requests.push(d);return d.promise;},
  confirm:(r,v)=>events.push(['confirm',r.id,v]),reject:r=>events.push(['reject',r.id]),definitive:e=>e.message==='pair_changed',schedule:time.globals.setTimeout,cancel:time.globals.clearTimeout});
 const row=id=>({id,owner:'me',path:'/api/vnext/command',payload:{action:'claim_daily_quest',assignmentId:id},key:id,amount:10,deferred:false});
 return{q,calls,events,requests,time,row,get disk(){return rows;},setOwner(value){owner=value;q.reset();},setActive(value){active=value;}};
}
test('durable outbox journals before projection, deduplicates taps and bounds network concurrency',async()=>{
 const x=queueHarness(),a=x.q.submit(x.row('a')),same=x.q.submit(x.row('a')),b=x.q.submit(x.row('b')),c=x.q.submit(x.row('c'));
 assert.equal(x.disk.length,3);assert.equal(x.calls.length,2);assert.equal(x.events.filter(e=>e[0]==='project'&&e[1]==='a').length,1);
 x.requests[0].resolve({reward:10});await flush();assert.equal(x.calls.length,3);x.requests[1].resolve({reward:10});x.requests[2].resolve({reward:10});await Promise.all([a,same,b,c]);assert.equal(x.disk.length,0);
});
test('timeout retains durable intent and retries exact payload; no rollback or duplicate projection',async()=>{
 const x=queueHarness(),a=x.q.submit(x.row('a'));x.requests[0].reject(Error('timeout'));await assert.rejects(a,/timeout/);await flush();
 assert.equal(x.disk.length,1);assert.equal(x.events.some(e=>e[0]==='reject'),false);
 x.time.advance(2000);assert.deepEqual(x.calls[1],x.calls[0]);assert.equal(x.events.filter(e=>e[0]==='project').length,1);
 x.requests[1].resolve({applied:false,reward:0});await flush();assert.equal(x.disk.length,0);
});
test('optimistic enqueue acknowledges only durable intent; receipt observers survive retries and cannot invalidate money',async()=>{
 const x=queueHarness(),events=[];x.q.subscribeSettled(event=>{events.push(event);throw Error('display-only failure');});
 const row={...x.row('a'),display:{scope:'me:pair',tamedCount:1}};
 const pending=x.q.enqueue(row);assert.equal(x.disk.length,1);assert.equal(x.q.pending()[0].display.tamedCount,1);
 const copy=x.q.pending();copy[0].display.tamedCount=999;assert.equal(x.q.pending()[0].display.tamedCount,1);
 x.requests[0].reject(Error('timeout'));await assert.rejects(pending,/timeout/);await flush();assert.equal(events.length,0);
 x.time.advance(2000);x.requests[1].resolve({balance:110});await flush();assert.equal(events.length,1);assert.equal(events[0].receipt.balance,110);assert.equal(x.q.pending().length,0);
 const bad=queueModel.createCoinOperationQueue({owner:()=> 'me',active:()=>true,load:()=>[],save:()=>{throw Error('disk full');},project(){assert.fail('not durable');},send(){assert.fail('not durable');},confirm(){},reject(){},definitive:()=>true,schedule(){},cancel(){}});
 assert.throws(()=>bad.enqueue(x.row('bad')),/intent_not_saved/);assert.equal(bad.pending().length,0);
});
test('restart restores silently, definitive failure clears only its intent, account switch rejects late receipts',async()=>{
 const x=queueHarness(),saved=x.row('a'),restart=queueHarness([saved]);restart.q.resume();assert.deepEqual(restart.events[0],['project','a',true]);
 restart.requests[0].reject(Error('pair_changed'));await flush();assert.equal(restart.disk.length,0);assert.ok(restart.events.some(e=>e[0]==='reject'));
 const y=queueHarness(),p=y.q.submit(y.row('a'));y.setOwner('other');await assert.rejects(p,/session_changed/);y.requests[0].resolve({reward:10});await flush();assert.equal(y.events.some(e=>e[0]==='confirm'),false);assert.equal(y.q.has('a'),false);
});
test('registry promotes the existing page wallet; nested portals restore their predecessor and unfocused owners unregister',()=>{
 const registry=load('apps/mobile/src/lib/coin-wallet-registry.ts',{react:{useSyncExternalStore:(_,read)=>read()}});
 const a={},b={},modal={},nested={};const leaveA=registry.registerCoinWallet({owner:a,anchor:{x:0,y:0,width:100,height:35},fontSize:18,onPress(){},disabled:false});
 const leaveB=registry.registerCoinWallet({owner:b,anchor:{x:2,y:3,width:120,height:35},fontSize:18,onPress(){},disabled:false});
 assert.equal(registry.getCoinWalletRegistry().slot.owner,b);const close=registry.claimCoinWalletPortal(modal),closeNested=registry.claimCoinWalletPortal(nested);
 assert.equal(registry.getCoinWalletRegistry().portal,nested);closeNested();assert.equal(registry.getCoinWalletRegistry().portal,modal);close();leaveB();assert.equal(registry.getCoinWalletRegistry().slot.owner,a);leaveA();assert.equal(registry.getCoinWalletRegistry().slot,null);
});
function controller(){const h=hooks(),m=motionHarness(h),finished=[];
 const api=load('apps/mobile/src/components/burrow/coin-reward-banner.tsx',{react:h.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
 'react-native':{Platform:{OS:'ios'},StyleSheet:{create:x=>x},AccessibilityInfo:{isReduceMotionEnabled:async()=>false,addEventListener:()=>({remove(){}}),announceForAccessibility(){}}},
 'react-native-reanimated':m.reanimated,'react-native-safe-area-context':{},'react-native-screens':{},'expo-router':{},'./coin-ui':{},'./animated-coin-balance':{},
 '@/lib/coin-reward-store':{coinRewardClock:()=>m.time.globals.Date.now()},'@/lib/burrow-motion':motion,'@/lib/haptics':{haptics:{light:async()=>{}}},
 },m.time.globals);
 return{h,...m,render:(batch,balance)=>h.render(()=>api.useCoinWalletController(batch,balance,(...args)=>finished.push(args))),finished};
}
test('one reward flies, counts, holds and fades for exactly 3000ms without a network dependency',()=>{
 assert.equal(motion.coinPresentationTiming(0).total,3000);assert.equal(motion.coinArrivalTiming(0).flightEnd,1200);
 const x=controller(),batch={id:1,earned:10,from:100,revision:1,celebration:1,flight:{id:1,startedAt:10000}};
 x.render(null,100);const model=x.render(batch,110);
 x.time.advance(899);assert.equal(model.count.value,100);assert.equal(x.finished.length,0);
 x.time.advance(301);assert.equal(model.count.value,110);
 x.time.advance(1499);assert.equal(model.pulse.value,1);assert.equal(x.finished.length,0);
 x.time.advance(300);assert.equal(x.finished.length,0);
 x.time.advance(1);assert.equal(model.pulse.value,0);assert.deepEqual(x.finished,[[1,1]]);
 assert.ok(x.timings.some(t=>t.value===0&&t.config.duration===300));x.h.unmount();
});
test('a late correction during fade preserves current opacity and original 3s deadline',()=>{
 const x=controller(),batch={id:1,earned:10,from:100,revision:1,celebration:1,flight:{id:1,startedAt:10000}};
 x.render(null,100);const model=x.render(batch,110);x.time.advance(2800);model.pulse.current=.6;
 x.render({...batch,revision:2},111);assert.equal(model.pulse.value,.6);
 x.time.advance(199);assert.equal(x.finished.length,0);x.time.advance(1);assert.deepEqual(x.finished,[[1,2]]);
 assert.ok(x.timings.some(t=>t.value===0&&t.config.duration===200));x.h.unmount();
});
test('native controller never rewinds on receipts; rapid claims preserve arrival deadline and stale completions cannot close a newer grant',()=>{
 const x=controller();x.render(null,100);let batch={id:1,earned:10,from:100,revision:1,celebration:1,flight:{id:1,startedAt:10000}};
 const first=x.render(batch,110);x.time.advance(400);assert.equal(first.count.value,100);
 x.render({...batch,revision:2},110);assert.equal(x.timings.filter(t=>t.value===1200).length,1);x.time.advance(800);assert.equal(first.count.value,110);
 batch={...batch,revision:3,celebration:2,earned:20};first.count.current=107;x.render(batch,120);assert.equal(first.count.value,107);
 x.time.advance(180);assert.equal(first.count.value,120);x.time.advance(1619);assert.equal(x.finished.length,0);x.time.advance(1);assert.deepEqual(x.finished,[[1,3]]);
 x.h.unmount();assert.equal(x.time.timers.size,0);
});
test('same mounted native counter keeps default text stable when React target changes and grows at digit boundaries',()=>{
 const h=hooks(),m=motionHarness(h),jsx=(type,props)=>({type,props});
 const {AnimatedCoinBalance}=load('apps/mobile/src/components/burrow/animated-coin-balance.tsx',{react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{TextInput:'Input',StyleSheet:{create:x=>x}},'react-native-reanimated':m.reanimated,'@/lib/burrow-motion':motion});
 const value={value:9};let target=59;const render=()=>h.render(()=>AnimatedCoinBalance({value,target,fontSize:18}));
 const a=render();assert.equal(a.props.style[0].textAlign,'center');value.value=15;target=110;const b=render();assert.equal(b.props.defaultValue,'9');assert.equal(b.props.animatedProps.text,'15');assert.ok(b.props.style.at(-1).width>a.props.style.at(-1).width);
 value.value=110;assert.equal(render().props.animatedProps.text,'110');h.unmount();
});
test('another flight during the hold starts its own arrival clock without rewinding the wallet',()=>{
 const x=controller(),first={id:1,earned:10,from:100,revision:1,celebration:1,flight:{id:1,startedAt:10000}};
 x.render(null,100);const model=x.render(first,110);x.time.advance(1500);assert.equal(model.count.value,110);
 const next={...first,earned:20,revision:2,celebration:2,flight:{id:2,startedAt:11500}};x.render(next,120);
 x.time.advance(899);assert.equal(model.count.value,110);x.time.advance(301);assert.equal(model.count.value,120);
 assert.equal(x.finished.length,0);x.time.advance(1799);assert.equal(x.finished.length,0);x.time.advance(1);assert.deepEqual(x.finished,[[1,2]]);x.h.unmount();
});
function runtime(){const time=clock(),disk=new Map(),listeners=[],calls=[],requests=[];let owner='me',epoch=1;
 const identity={sessionUserId:()=>owner,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>listeners.push(fn)};
 const store=load('apps/mobile/src/lib/coin-reward-store.ts',{react:{useSyncExternalStore:(_,read)=>read()},'./session-lifecycle':identity,'./coin-reward-ledger':ledgerModel,'./burrow-motion':motion},time.globals);
 store.syncCoinWallet(wallet().wallet,wallet());
 const outbox=load('apps/mobile/src/lib/coin-command-outbox.ts',{
  'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},'./api':{apiClient:{post:(path,payload)=>{calls.push({path,payload});const d=deferred();requests.push(d);return d.promise;}}},
  './async-lifecycle':{withDeadline:p=>p},'./storage':{storage:{getString:k=>disk.get(k),set:(k,v)=>disk.set(k,v)}},'../shared/storage/keys':{kCoinOperations:{name:'outbox'}},
  './session-lifecycle':identity,'./coin-reward-store':store,'./coin-operation-queue':queueModel,
 },time.globals);
 return{...outbox,store,time,calls,requests,disk,change(){owner='other';epoch++;listeners.forEach(fn=>fn());}};
}
test('actual command outbox projects once and validates daily receipt before settling; replay after timeout does not flicker',async()=>{
 const x=runtime(),op={id:'plus-login:2026-10-17',key:'plus-login:2026-10-17',amount:50,deferred:false,path:'/api/vnext/command',payload:{action:'claim_daily_plus_bonus',localDate:'2026-10-17'}};
 const p=x.submitCoinOperation(op);assert.equal(x.store.getCoinRewardSnapshot().displayBalance,150);assert.equal(x.calls.length,1);
 x.requests[0].reject(Error('timeout'));await assert.rejects(p,/timeout/);await flush();assert.equal(x.store.getCoinRewardSnapshot().displayBalance,150);
 x.time.advance(2000);assert.deepEqual(x.calls[1],x.calls[0]);
 x.requests[1].resolve({applied:false,reward:0,coinReward:{key:op.key,amount:0},coinState:wallet(150,2,[[op.key,50]]),dailyPlusBonus:{claimed:true,key:op.key,localDate:'2026-10-17'}});await flush();
 assert.equal(x.store.getCoinRewardSnapshot().displayBalance,150);assert.equal(x.store.getCoinRewardSnapshot().batch.earned,50);assert.equal(x.coinOperations.has(op.id),false);
});
test('actual outbox cannot settle another pair/account; restoring malformed or debit intents cannot dispatch them',async()=>{
 const x=runtime(),op={id:'release-ui:key',key:'release:key',amount:10,deferred:true,path:'/api/vnext/release-room',payload:{actorId:'me',partnerId:'partner',pairVersion:'pair',idempotencyKey:'key'}};
 const p=x.submitCoinOperation(op);x.requests[0].resolve({status:{partnerId:'other',pairVersion:'pair'},coinState:wallet(110,2,[['release:key',10]])});
 await assert.rejects(p,/pair_changed/);assert.equal(x.store.getCoinRewardSnapshot().balance,100);
 const y=runtime(),late=y.submitCoinCommand('claim_daily_quest',{assignmentId:'q'});y.change();await assert.rejects(late,/session_changed/);y.requests[0].resolve({coinState:wallet(110,2,[['daily-quest:q',10]])});await flush();assert.equal(y.store.getCoinRewardSnapshot().balance,null);
 const z=queueHarness([{...queueHarness().row('bad'),payload:{action:'purchase_catalog_item',itemId:'unwanted'}}]);z.q.resume();assert.equal(z.calls.length,0);
});
test('an explicit reward key and payload are immutable once journaled',async()=>{
 const x=queueHarness(),row=x.row('a'),p=x.q.submit(row);row.payload.assignmentId='changed';assert.equal(x.calls[0].payload.assignmentId,'a');
 await assert.rejects(x.q.submit({...x.row('a'),payload:{action:'claim_daily_quest',assignmentId:'changed'}}),/idempotency_conflict/);
 x.requests[0].resolve({reward:10});await p;
});
for(const receiptFirst of [false,true])test(`logged record uses one staged ticket, before or after its receipt (${receiptFirst})`,async()=>{
 const x=runtime(),id='record:journal:local-save',key='record-first:2026-10-17';
 x.stageCoinOperationReward(id,key,10);x.stageCoinOperationReward(id,key,10);
 assert.equal(x.calls.length,0,'staging cannot send a request before a real draft exists');
 assert.equal(x.store.getCoinRewardSnapshot().balance,110);
 assert.equal(x.store.getCoinRewardSnapshot().displayBalance,100);assert.equal(x.store.getCoinRewardSnapshot().batch,null);
 if(!receiptFirst)x.store.releaseCoinReward(id);
 const first=x.store.getCoinRewardSnapshot().batch;
 const work=x.submitCoinOperation({id,key,amount:10,deferred:true,path:'/api/reflect/finalize',payload:{draftId:'actual-server-draft'}});
 assert.equal(x.store.getCoinRewardSnapshot().balance,110,'command must reuse, not replace or double-project the early ticket');
 x.requests[0].resolve({success:true,coinReward:{key,amount:10},coinState:wallet(110,2,[[key,10]])});await work;
 if(receiptFirst){assert.equal(x.store.getCoinRewardSnapshot().batch,null);assert.equal(x.store.getCoinRewardSnapshot().displayBalance,100);x.store.releaseCoinReward(id);}
 const batch=x.store.getCoinRewardSnapshot().batch;assert.equal(batch.earned,10);assert.equal(batch.celebration,1);
 if(!receiptFirst)assert.equal(batch.flight.startedAt,first.flight.startedAt);
 assert.equal(x.store.getCoinRewardSnapshot().displayBalance,110);
 x.store.releaseCoinReward(id);assert.equal(x.store.getCoinRewardSnapshot().batch,batch);
});
test('staged record reward respects today already claimed, cap, rollback and account isolation',()=>{
 const key='record-first:2026-10-17',id='record:journal:save';
 const claimed=runtime();claimed.store.syncCoinWallet(wallet(110,2,[[key,10]]).wallet,wallet(110,2,[[key,10]]));
 claimed.stageCoinOperationReward(id,key,10);claimed.store.releaseCoinReward(id);
 assert.equal(claimed.store.getCoinRewardSnapshot().displayBalance,110);assert.equal(claimed.store.getCoinRewardSnapshot().batch,null);
 const cap=runtime();cap.store.syncCoinWallet(wallet(99999,2).wallet,wallet(99999,2));cap.stageCoinOperationReward(id,key,10);cap.store.releaseCoinReward(id);
 assert.equal(cap.store.getCoinRewardSnapshot().displayBalance,99999);assert.equal(cap.store.getCoinRewardSnapshot().batch,null);
 const failed=runtime();failed.stageCoinOperationReward(id,key,10);failed.store.releaseCoinReward(id);failed.cancelStagedCoinOperationReward(id);
 assert.equal(failed.store.getCoinRewardSnapshot().displayBalance,100);assert.equal(failed.store.getCoinRewardSnapshot().batch,null);
 const switched=runtime();switched.stageCoinOperationReward(id,key,10);switched.change();switched.store.releaseCoinReward(id);
 assert.equal(switched.store.getCoinRewardSnapshot().displayBalance,null);assert.equal(switched.store.getCoinRewardSnapshot().batch,null);
});
test('ambiguous queued record keeps its original ticket until the server receipt, even if the worker blocks',async()=>{
 const x=runtime(),id='record:journal:pending',key='record-first:2026-10-17';
 x.stageCoinOperationReward(id,key,10);x.store.releaseCoinReward(id);
 const work=x.submitCoinOperation({id,key,amount:10,deferred:true,path:'/api/reflect/finalize',payload:{draftId:'draft'}});
 x.cancelStagedCoinOperationReward(id);assert.equal(x.store.getCoinRewardSnapshot().displayBalance,110);
 x.requests[0].resolve({success:true,coinReward:{key,amount:10},coinState:wallet(110,2,[[key,10]])});await work;
 assert.equal(x.store.getCoinRewardSnapshot().balance,110);assert.equal(x.store.getCoinRewardSnapshot().batch.celebration,1);
});
