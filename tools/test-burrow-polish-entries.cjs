const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,clock,deferred,hooks}=require('./lifecycle-test-utils.cjs');

test('toast replaces the old message, lasts two seconds from the latest tap, and never queues',()=>{
 const c=clock(),m=load('apps/mobile/src/lib/burrow-toast.ts',{},c.globals);let updates=0;
 const unsubscribe=m.burrowToast.subscribe(()=>updates++);
 m.showBurrowToast('Your bunny is full and happy.');c.advance(1500);
 m.showBurrowToast('Your flower is fresh and growing.');c.advance(500);
 assert.equal(m.burrowToast.read().message,'Your flower is fresh and growing.');
 c.advance(1499);assert.ok(m.burrowToast.read());c.advance(1);assert.equal(m.burrowToast.read(),null);
 assert.equal(updates,3);m.showBurrowToast('No history yet');m.clearBurrowToast();c.advance(2000);
 assert.equal(m.burrowToast.read(),null);unsubscribe();
});
test('toast is above the Home tabs, non-blocking, and clears on navigation or identity change',()=>{
 const h=hooks(),c=clock(),toast=load('apps/mobile/src/lib/burrow-toast.ts',{},c.globals);
 let segments=['(main)','(tabs)'],identity;
 const layout=load('apps/mobile/src/lib/burrow-home-layout.ts');
 const jsx=(type,props)=>({type,props});
 const {BurrowToastHost}=load('apps/mobile/src/components/burrow/burrow-toast-host.tsx',{
  react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
  'react-native':{View:'View',Text:'Text',StyleSheet:{create:x=>x},useWindowDimensions:()=>({width:390})},
  'expo-router':{useSegments:()=>segments},'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:34})},
  '@/lib/burrow-toast':toast,'@/lib/burrow-home-layout':layout,
  '@/lib/session-lifecycle':{subscribeSessionIdentity:fn=>{identity=fn;return()=>{};}},
 });
 const render=()=>h.render(BurrowToastHost);render();toast.showBurrowToast('Your bunny is full and happy.');
 let tree=render();assert.equal(tree.props.pointerEvents,'none');
 assert.equal(tree.props.style[1].bottom,layout.homeTabBarHeight(390,34)+10);
 assert.equal(tree.props.children.props.style.backgroundColor,'rgba(0,0,0,.72)');
 assert.equal(tree.props.children.props.children.props.style.color,'#FFFFFF');
 segments=['(main)','game-room'];render();assert.equal(render(),null);
 toast.showBurrowToast('No play history yet.');tree=render();assert.equal(tree.props.style[1].bottom,54);
 identity();assert.equal(render(),null);h.unmount();
});

const engine=load('packages/engine/src/items/tap-your-day.ts',Object.fromEntries(
 ['v1','v2','v4','local'].map(v=>['./tap-your-day-'+v+'.json',require('../packages/engine/src/items/tap-your-day-'+v+'.json')])));
const display=load('apps/mobile/src/lib/tap-day-display-order.ts',{'@novame/engine':engine});
test('all 391 icons have a fixed question/category/icon order, independent of API array order',()=>{
 const expected=engine.TAP_YOUR_DAY_QUESTIONS.flatMap(q=>q.groups.flatMap(g=>[
  ...g.choices,...engine.TAP_YOUR_DAY_OPTIONAL_CHOICES.filter(c=>c.kind===q.kind&&c.group===g.title)]));
 assert.equal(expected.length,391);
 const input=expected.map((c,i)=>({...c,label:'Saved label '+i})).reverse(),original=input.slice();
 const sorted=display.orderedTapDayItems(input);
 assert.deepEqual(Array.from(sorted,c=>c.itemId),Array.from(expected,c=>c.itemId));
 assert.deepEqual(input,original,'sorting must not mutate the shared/bootstrap/cache record');
 for(const item of sorted)assert.equal(item,original.find(x=>x.itemId===item.itemId),'saved labels and objects remain intact');
 const shuffled=[...input.filter((_,i)=>i%2),...input.filter((_,i)=>!(i%2))];
 assert.deepEqual(Array.from(display.orderedTapDayItems(shuffled),c=>c.itemId),Array.from(sorted,c=>c.itemId));
});
test('retired and unknown icons remain visible at a deterministic tail without altering text',()=>{
 const known=engine.TAP_YOUR_DAY_CHOICES[0],a={itemId:'retired.a',label:'Old label'},z={itemId:'retired.z',label:'Z'};
 assert.deepEqual(Array.from(display.orderedTapDayItems([z,known,a]),x=>x.itemId),[known.itemId,a.itemId,z.itemId]);
});

function historyHarness(){
 let user='me',epoch=1,identity,data={profile:{id:'me'},partner:{id:'partner'},pairVersion:'v1'},cache=null,fresh=false;
 const games=deferred(),received=deferred(),sent=deferred(),calls=[],pages={received:{items:[]},sent:{items:[]}},viewed=new Set();
 const m=load('apps/mobile/src/lib/room-history-entry.ts',{
  './session-lifecycle':{sessionUserId:()=>user,sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;}},
  './burrow-store':{getBurrowSnapshot:()=>({data})},
  './burrow-game-local':{gameResultViewed:id=>viewed.has(id)},
  './burrow-game-room-api':{gameHistory:()=>{calls.push('games');return games.promise;}},
  './burrow-game-room-cache':{getCachedGameHistory:()=>cache,gameHistoryNeedsRefresh:()=>!fresh,cacheGameHistory:next=>{cache=next;fresh=true;}},
  './surprise-api':{listSurpriseHistory:direction=>{calls.push(direction);return direction==='received'?received.promise:sent.promise;}},
  './surprise-history-cache':{cachedSurpriseHistory:(_scope,direction)=>pages[direction],surpriseHistoryRevision:()=>1,
   saveSurpriseHistoryPage:(_scope,direction,page)=>{pages[direction]=page;}},
 });
 return{...m,scope:'me:partner:v1',games,received,sent,calls,pages,viewed,cache:()=>cache,
  setCache:(value,isFresh=true)=>{cache=value;fresh=isFresh;},rotatePair:()=>{data={...data,partner:{id:'new'}};},
  switchUser:()=>{user='other';epoch++;identity();}};
}
const round=(id,outcome='win')=>({id,gameId:'same-game',createdAt:'2026-10-20T10:00:00Z',resultViewedAt:'now',result:{outcome}});
test('history availability coalesces reads and keeps three separate rounds of the same game (two wins, one loss)',async()=>{
 const h=historyHarness(),a=h.prepareGameHistoryEntry(h.scope),b=h.prepareGameHistoryEntry(h.scope);
 assert.deepEqual(h.calls,['games']);h.games.resolve({paired:true,rounds:[round('1'),round('2'),round('3','lose')],nextCursor:null});
 assert.equal(await a,true);assert.equal(await b,true);assert.equal(h.cache().rounds.length,3);
 assert.equal(h.cache().rounds.filter(r=>r.result.outcome==='win').length,2);
 assert.equal(await h.prepareGameHistoryEntry(h.scope),true);assert.deepEqual(h.calls,['games']);
});
test('empty history is cached while errors never become a false No history result',async()=>{
 const h=historyHarness(),p=h.prepareGameHistoryEntry(h.scope);h.games.resolve({paired:true,rounds:[],nextCursor:null});
 assert.equal(await p,false);assert.equal(await h.prepareGameHistoryEntry(h.scope),false);assert.equal(h.calls.length,1);
 const failing=historyHarness(),bad=failing.prepareGameHistoryEntry(failing.scope);failing.games.reject(Error('offline'));
 await assert.rejects(bad,/offline/);assert.equal(failing.cache(),null);
});
test('a just-viewed local result opens history without waiting for the background viewed receipt',async()=>{
 const h=historyHarness(),r={...round('local'),resultViewedAt:null};h.setCache({rounds:[r]});h.viewed.add(r.id);
 assert.equal(await h.prepareGameHistoryEntry(h.scope),true);assert.deepEqual(h.calls,[]);
});
test('pair rotation rejects even fresh cached history; late old-account responses never enter caches',async()=>{
 const h=historyHarness();h.setCache({rounds:[round('old')]});h.rotatePair();
 await assert.rejects(h.prepareGameHistoryEntry(h.scope),/session_changed/);
 await assert.rejects(h.prepareSurpriseHistoryEntry(h.scope),/session_changed/);assert.deepEqual(h.calls,[]);
 const late=historyHarness(),p=late.prepareGameHistoryEntry(late.scope);late.switchUser();
 late.games.resolve({rounds:[round('old')]});await assert.rejects(p,/session_changed/);assert.equal(late.cache(),null);
});
test('Surprise checks both sent and received metadata, coalesces requests, and does not fetch media',async()=>{
 const h=historyHarness(),a=h.prepareSurpriseHistoryEntry(h.scope),b=h.prepareSurpriseHistoryEntry(h.scope);
 assert.deepEqual(h.calls,['received','sent']);h.received.resolve({items:[]});h.sent.resolve({items:[{id:'sent-one'}]});
 assert.equal(await a,true);assert.equal(await b,true);assert.equal(await h.prepareSurpriseHistoryEntry(h.scope),true);
 assert.equal(h.calls.length,2);
 const empty=historyHarness(),p=empty.prepareSurpriseHistoryEntry(empty.scope);
 empty.received.resolve({items:[]});empty.sent.resolve({items:[]});assert.equal(await p,false);
});
