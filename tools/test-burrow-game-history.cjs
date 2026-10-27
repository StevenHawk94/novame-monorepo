const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');
const scorer = load('apps/api/src/lib/burrow-game-room.mjs');
const helper = load('apps/api/src/lib/burrow-game-history.mjs', { './burrow-game-room.mjs': scorer });
const me = '11111111-1111-4111-8111-111111111111', partner = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-10T12:30:00.123456+00:00';
const row = index => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`, game_id: 'daily_quirks_01',
  created_at: stamp, completed_at: stamp,viewer:[{user_id:me,result_viewed_at:stamp}], burrow_game_progress: [
    { user_id: me, own_answers: [0,0,0,0,0,0], guesses: [1,1,1,1,1,1] },
    { user_id: partner, own_answers: [1,1,1,1,1,1], guesses: [0,0,0,0,0,1] },
  ] });
test('three sessions of the same game remain three scored records, including two wins and one loss',async()=>{
 const rounds=[row(1),row(2),row(3)];rounds[2].burrow_game_progress[0].guesses=[0,0,0,0,0,0];
 const page=await helper.gameHistoryPage(dbHarness({rows:rounds}).db,me);
 assert.equal(page.rounds.length,3);assert.equal(new Set(page.rounds.map(r=>r.id)).size,3);
 assert.deepEqual(Array.from(page.rounds,r=>r.result.outcome),['win','win','lose']);
});

function dbHarness({ rows = [row(1)], paired = true, changed = false, rotated = false, fail = false } = {}) {
  const filters = []; let pairReads = 0, versionReads = 0;
  const query = {};
  for (const name of ['select','eq','not','order','limit','or']) query[name] = (...args) => { filters.push([name,...args]); return query; };
  query.then = (resolve, reject) => Promise.resolve({ data: rows, error: fail ? Error('storage_failed') : null }).then(resolve, reject);
  const db = { from: table => { filters.push(['from',table]); return query; }, rpc: async (name, args) => {
    if (name === 'lock_burrow_pair') { assert.equal(args.p_user, me); return { data: !paired ? null : changed && pairReads++ ? 'other-partner' : partner }; }
    assert.equal(name, 'burrow_pair_version_v1'); assert.equal(args.p_partner_id, partner);
    return { data: rotated && versionReads++ ? 'v2' : 'v1' };
  } };
  return { db, filters };
}

test('history uses only current pair/version, scores from actor perspective, and strips answer arrays', async () => {
  const h = dbHarness();
  const page = await helper.gameHistoryPage(h.db, me);
  assert.equal(page.rounds[0].result.mine, 6);
  assert.equal(page.rounds[0].result.partner, 5);
  assert.equal(page.rounds[0].result.outcome, 'win');
  assert.equal(page.nextCursor, null);
  assert.equal(page.rounds[0].burrow_game_progress, undefined);
  assert.equal(page.rounds[0].resultViewedAt,stamp);
  assert.ok(h.filters.some(x => x[0] === 'eq' && x[1] === 'pair_low' && x[2] === me));
  assert.ok(h.filters.some(x => x[0] === 'eq' && x[1] === 'pair_high' && x[2] === partner));
  assert.ok(h.filters.some(x => x[0] === 'eq' && x[1] === 'pair_version' && x[2] === 'v1'));
  assert.ok(h.filters.some(x => x[0] === 'not' && x[1] === 'completed_at'));
  assert.ok(h.filters.some(x=>x[0]==='eq'&&x[1]==='viewer.user_id'&&x[2]===me));
  assert.ok(h.filters.some(x=>x[0]==='not'&&x[1]==='viewer.result_viewed_at'));
  const lose = row(2); lose.burrow_game_progress[0].guesses = [0,0,0,0,0,0];
  assert.equal((await helper.gameHistoryPage(dbHarness({rows:[lose]}).db, me)).rounds[0].result.outcome, 'lose');
  const tie = row(3); tie.burrow_game_progress[1].guesses = [0,0,0,0,0,0];
  assert.equal((await helper.gameHistoryPage(dbHarness({rows:[tie]}).db, me)).rounds[0].result.outcome, 'tie');
});

test('keyset history pagination preserves microseconds and uses ID as stable equal-date tie breaker', async () => {
  const h = dbHarness({ rows: Array.from({length:31},(_,i)=>row(i+1)) });
  const page = await helper.gameHistoryPage(h.db, me);
  assert.equal(page.rounds.length,30);
  const cursor = helper.parseGameHistoryCursor(page.nextCursor);
  assert.equal(cursor.createdAt,stamp);
  assert.equal(cursor.id,row(30).id);
  const next = dbHarness(); await helper.gameHistoryPage(next.db, me, cursor);
  assert.ok(next.filters.some(x=>x[0]==='or'&&x[1].includes(`id.lt.${row(30).id}`)&&x[1].includes(stamp)));
});

test('unpaired users never query history; connection changes, storage failures and invalid cursors fail closed', async () => {
  const unpaired = dbHarness({ paired:false });
  assert.equal((await helper.gameHistoryPage(unpaired.db,me)).rounds.length,0);
  assert.equal(unpaired.filters.length,0);
  await assert.rejects(helper.gameHistoryPage(dbHarness({changed:true}).db,me),/pair_changed/);
  await assert.rejects(helper.gameHistoryPage(dbHarness({rotated:true}).db,me),/pair_changed/);
  await assert.rejects(helper.gameHistoryPage(dbHarness({fail:true}).db,me),/storage_failed/);
  for (const value of ['bad','null','[]',JSON.stringify({id:me,createdAt:'now'}),JSON.stringify({id:'or(filter)',createdAt:stamp})])
    assert.throws(()=>helper.parseGameHistoryCursor(value),/invalid_request/);
});

test('history HTTP route requires auth/rollout and rejects malformed cursor before reading private data', async () => {
  let auth=me, enabled=true, reads=0;
  const route = load('apps/api/src/app/api/vnext/game-room/route.js', {
    'next/server': { NextResponse:{json:(body,options)=>({body,status:options.status})} },
    '@/data/burrow-game-room-v1.json':require('../apps/api/src/data/burrow-game-room-v1.json'),
    '@/lib/burrow-game-room.mjs':scorer,
    '@/lib/burrow-game-history.mjs':{...helper,gameHistoryPage:async()=>{reads++;return{paired:true,rounds:[],nextCursor:null};}},
    '@/lib/push-notifications':{},
    '@/lib/app-major-update':{authenticatedUserId:async()=>auth,majorUpdateEnabled:async()=>enabled,appMajorUpdateServiceClient:()=>({}),commandStatus:()=>400},
  },{URL});
  const get=query=>route.GET({url:`https://test.invalid/api/vnext/game-room?mode=history${query??''}`});
  auth=null; assert.equal((await get()).status,401); assert.equal(reads,0);
  auth=me;enabled=false;assert.equal((await get()).status,403);assert.equal(reads,0);
  enabled=true;assert.equal((await get('&cursor=bad')).status,400);assert.equal(reads,0);
  assert.equal((await get()).status,200);assert.equal(reads,1);
});

const jsx=(type,props)=>({type,props});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children),
  ...nodes(tree.props?.ListHeaderComponent),...nodes(tree.props?.ListFooterComponent),
  ...(tree.type==='FlatList'?(tree.props.data??[]).flatMap((item,index)=>nodes(tree.props.renderItem?.({item,index}))):[])]:[];
function historyHarness({cached=null,viewed=new Set()}={}) {
  const h=hooks(),pending=[],pushes=[];let focus=true,epoch=1,identity;
  const data={profile:{id:me},partner:{id:partner,display_name:'Alex'},pairVersion:'v1'};
  const scope=()=>`${data.profile.id}:${data.partner?.id??''}:${data.pairVersion}`;
  let cachedScope=scope();
  const {GameHistoryScreen}=load('apps/mobile/src/components/burrow/game-history-screen.tsx',{
    '@/lib/burrow-page-entry':{openPreparedBurrow:r=>pushes.push(r)},
    react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},
    'react-native':{View:'View',Text:'Text',ImageBackground:'Background',Pressable:'Pressable',FlatList:'FlatList',ScrollView:'ScrollView',ActivityIndicator:'Loader',StyleSheet:{create:x=>x}},
    'expo-router':{router:{push:x=>pushes.push(x),back(){}},useFocusEffect:fn=>h.react.useEffect(()=>focus?fn():undefined,[focus,fn])},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:44,bottom:34})},
    './burrow-image':{Image:'Image'},'./burrow-back-button':{BurrowBackButton:'Back'},'@/lib/burrow-store':{useBurrow:()=>({data})},
    '@/lib/burrow-game-room-api':{gameHistory:cursor=>{const d=deferred();pending.push({cursor,...d});return d.promise;}},
    '@/lib/burrow-game-room-cache':{getCachedGameHistory:s=>s===cachedScope?cached:null,gameHistoryNeedsRefresh:(_now,s)=>!cached||s!==cachedScope,
      cacheGameHistory:(value,_now,s)=>{cached=value;cachedScope=s;}},
    '@/lib/burrow-game-room-content':{GAME_ROOM_GAMES:[{id:'daily_quirks_01',title:'Morning Mode'}]},
    '@/lib/burrow-game-room-art':{gameRoomBackground:1,gameRoomIcons:{daily_quirks_01:2}},
    '@/lib/session-lifecycle':{sessionEpoch:()=>epoch,subscribeSessionIdentity:fn=>{identity=fn;return()=>{};}},
    '@/lib/burrow-game-local':{useLocalGames(){},gameResultViewed:id=>viewed.has(id)},
  });
  return {render:()=>h.render(GameHistoryScreen),pending,pushes,data,viewed,blur:()=>{focus=false;},identity:()=>{epoch++;cached=null;identity();},unmount:h.unmount};
}
const rounds=[{id:row(1).id,gameId:'daily_quirks_01',createdAt:stamp,completedAt:stamp,resultViewedAt:stamp,result:{mine:6,partner:5,outcome:'win'}}];
test('cached history renders icon/name/Win instantly and taps navigate directly to the saved result',()=>{
  const h=historyHarness({cached:{paired:true,rounds,nextCursor:null}});
  const tree=nodes(h.render());
  assert.equal(h.pending.length,0);assert.equal(tree.some(n=>n.type==='Loader'),false);
  assert.ok(tree.some(n=>n.props?.children==='Win'));assert.ok(tree.some(n=>n.props?.children==='Morning Mode'));
  tree.find(n=>n.props?.accessibilityLabel==='Morning Mode. Win').props.onPress();
  assert.equal(h.pushes[0].params.sessionId,rounds[0].id);assert.equal(h.pushes[0].params.source,'history');h.unmount();
});
test('unviewed results remain outside History until local or server acknowledgement',()=>{
  const unread={...rounds[0],resultViewedAt:null};
  const h=historyHarness({cached:{paired:true,rounds:[unread],nextCursor:null}});
  assert.ok(nodes(h.render()).some(n=>n.props?.children==='No history yet'));
  h.viewed.add(unread.id);assert.ok(nodes(h.render()).some(n=>n.props?.children==='Win'));h.unmount();
});
test('view-result command authenticates the actor and rejects malformed session IDs before RPC',async()=>{
  const calls=[];let actor=me;
  const route=load('apps/api/src/app/api/vnext/game-room/route.js',{
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options.status})}},
    '@/data/burrow-game-room-v1.json':require('../apps/api/src/data/burrow-game-room-v1.json'),
    '@/lib/burrow-game-room.mjs':scorer,'@/lib/burrow-game-history.mjs':helper,'@/lib/push-notifications':{},
    '@/lib/app-major-update':{authenticatedUserId:async()=>actor,majorUpdateEnabled:async()=>true,commandStatus:error=>error?400:200,
      appMajorUpdateServiceClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{viewedAt:stamp}};}})},
  });
  const post=body=>route.POST({text:async()=>JSON.stringify({action:'view_result',...body})});
  actor=null;assert.equal((await post({sessionId:row(1).id})).status,401);assert.equal(calls.length,0);
  actor=me;assert.equal((await post({sessionId:'bad'})).status,400);assert.equal(calls.length,0);
  assert.equal((await post({sessionId:row(1).id,userId:partner})).status,200);
  assert.equal(calls[0].name,'burrow_game_view_result_v1');assert.equal(calls[0].args.p_user_id,me);
});
test('history supports loading earlier games, deduplicates pages, and rejects late background/identity responses',async()=>{
  const h=historyHarness();h.render();h.pending[0].resolve({paired:true,rounds,nextCursor:'older'});await flush();
  let tree=nodes(h.render());tree.find(n=>n.props?.children?.props?.children==='Load earlier games').props.onPress();
  h.pending[1].resolve({paired:true,rounds:[...rounds,{...rounds[0],id:row(2).id,result:{mine:5,partner:5,outcome:'tie'}}],nextCursor:null});await flush();
  tree=nodes(h.render());assert.equal(tree.filter(n=>n.props?.accessibilityRole==='button'&&n.props?.accessibilityLabel?.startsWith('Morning Mode')).length,2);
  assert.ok(tree.some(n=>n.props?.children==='Tie'));h.unmount();
  const stale=historyHarness();stale.render();stale.blur();stale.render();stale.pending[0].resolve({paired:true,rounds,nextCursor:null});await flush();
  assert.equal(nodes(stale.render()).some(n=>n.props?.children==='Win'),false);stale.unmount();
  const account=historyHarness();account.render();account.identity();account.pending[0].resolve({paired:true,rounds,nextCursor:null});await flush();
  assert.equal(nodes(account.render()).some(n=>n.props?.children==='Win'),false);account.unmount();
});

test('history entry uses the shared clock icon and saved result back returns without starting a game',()=>{
  const source=fs.readFileSync('apps/mobile/src/components/burrow/game-room-screen.tsx','utf8');
  assert.match(source,/<Feather name="clock" size=\{26\}/);
  assert.match(source,/params:\s*\{\s*history:\s*'1'\s*\}/);
  assert.match(source,/onPress=\{fromHistory\?back:leave\}/);
  assert.match(source,/<Button label="Done" onPress=\{fromHistory\?back:leave\}/);
});

test('empty history is visible immediately during a hung sync, and network failure stays silent',async()=>{
  const h = historyHarness();
  h.render();
  const tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.children === 'No history yet'));
  assert.equal(tree.some(n => n.type === 'Loader'), false);
  h.pending[0].reject(Error('Network request failed')); await flush();
  const after = nodes(h.render());
  assert.ok(after.some(n => n.props?.children === 'No history yet'));
  assert.equal(after.some(n => n.props?.accessibilityRole === 'alert'), false);
  h.unmount();
});
