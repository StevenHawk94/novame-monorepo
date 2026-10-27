const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, deferred, flush, clock } = require('./lifecycle-test-utils.cjs');
const catalog = require('../apps/api/src/data/burrow-game-room-v1.json');
const content = load('apps/mobile/src/lib/burrow-game-room-content.ts', {
  '../../../api/src/data/burrow-game-room-v1.json': catalog,
});
const game = catalog.games[0];
const progress = { id: '11111111-1111-4111-8111-111111111111', gameId: game.id,
  completedAt: null, ownAnswers: [], guesses: [], partnerOwnCount: 0, partnerGuessCount: 0,
  partnerOwnAnswers: null, partnerGuesses: null, notifyReady: false, result: null };

test('game rails stably place Plus offers last, hide inactive entries and never mutate input',()=>{
  const items=Object.freeze([
    Object.freeze({id:'plus-first',plus_only:true}),
    Object.freeze({id:'paid',price:150,plus_only:false}),
    Object.freeze({id:'hidden',active:false}),
    Object.freeze({id:'free',price:0,plus_only:false}),
    Object.freeze({id:'plus-second',plus_only:true}),
  ]);
  assert.deepEqual(Array.from(content.gameRailItems(items),g=>g.id),['paid','free','plus-first','plus-second']);
  assert.deepEqual(items.map(g=>g.id),['plus-first','paid','hidden','free','plus-second']);
  assert.equal(content.gameRailItems([]).length,0);
});

test('complete bundled catalogue has local artwork and 420 valid questions', () => {
  assert.equal(content.GAME_ROOM_GAMES.length, 70);
  assert.equal(content.GAME_ROOM_CATEGORIES.length, 7);
  assert.equal(catalog.games.reduce((sum, item) => sum + item.questions.length, 0), 420);
  for (const item of catalog.games) {
    assert.ok(content.GAME_ROOM_CATEGORIES.includes(item.category));
    assert.ok(item.title && item.hook);
    assert.equal(item.questions.length, 6);
    const filename = `${item.title.replace(/\s+[^\x00-\x7F].*$/u, '').trim()}.webp`;
    assert.ok(fs.existsSync(path.resolve(__dirname, '../apps/mobile/assets/burrow-webp/game-room-icons', filename)));
    for (const question of item.questions) {
      assert.ok(question.self && question.partner);
      assert.equal(question.options.length, 4);
    }
  }
});

test('all 70 game IDs use the supplied standalone icons', () => {
  const stubs = Object.fromEntries(catalog.games.map(game => {
    const filename = `${game.title.replace(/\s+[^\x00-\x7F].*$/u, '').trim()}.webp`;
    const asset = `../../assets/burrow-webp/game-room-icons/${filename}`;
    return [asset, asset];
  }));
  stubs['../../assets/burrow-webp/basic-bg.webp'] = 'background';
  const artwork = load('apps/mobile/src/lib/burrow-game-room-art.ts', stubs);
  assert.deepEqual(Object.keys(artwork.gameRoomIcons).sort(), catalog.games.map(game => game.id).sort());
  for (const game of catalog.games) {
    const filename = `${game.title.replace(/\s+[^\x00-\x7F].*$/u, '').trim()}.webp`;
    assert.equal(artwork.gameRoomIcons[game.id], `../../assets/burrow-webp/game-room-icons/${filename}`);
  }
});

test('visible titles contain only text while canonical IDs and questions stay unchanged', () => {
  assert.equal(content.GAME_ROOM_GAMES.length, catalog.games.length);
  for (const [index, visible] of content.GAME_ROOM_GAMES.entries()) {
    assert.equal(visible.id, catalog.games[index].id);
    assert.equal(visible.title, catalog.games[index].title.replace(/\s+[^\x00-\x7F].*$/u, '').trim());
    assert.match(visible.title, /^[\x20-\x7E]+$/);
    assert.equal(content.localGameSession({ ...progress, gameId: visible.id }).questions, catalog.games[index].questions);
  }
});

test('remote state cannot replace locally bundled names, categories or introductions', () => {
  const state = { paired: true, ownedIds: [game.id], availableIds: [game.id], sessions: [progress],
    games: [{ title: 'obsolete remote title' }], categories: ['obsolete category'] };
  const overview = content.localGameOverview(state);
  assert.equal(overview.games, content.GAME_ROOM_GAMES);
  assert.equal(overview.categories, content.GAME_ROOM_CATEGORIES);
  assert.equal(overview.sessions, state.sessions);
  assert.equal(overview.paired, true);
});

test('rounds use local questions, accept JSONB key reordering, reject changed option order', () => {
  assert.equal(content.localGameSession(progress).questions, game.questions);
  const reordered = game.questions.map(q => ({ options: [...q.options], partner: q.partner, self: q.self }));
  assert.equal(content.localGameSession({ ...progress, questions: reordered }).questions, game.questions);
  const changed = reordered.map(q => ({ ...q, options: [...q.options].reverse() }));
  assert.throws(() => content.localGameSession({ ...progress, questions: changed }), /game_content_update_required/);
  assert.throws(() => content.localGameSession({ ...progress, gameId: 'unknown' }), /game_content_update_required/);
});

test('mobile API requests state-only responses and hydrates questions locally', async () => {
  const requests = [];
  const api = load('apps/mobile/src/lib/burrow-game-room-api.ts', {
    'expo-crypto': { randomUUID: () => progress.id }, '@novame/api-client': { ApiError: class extends Error {} },
    './api': { apiClient: { get: async url => { requests.push(url); return url.includes('mode=session') ? progress : { paired: true, availableIds: [game.id] }; } } },
    './async-lifecycle': { withDeadline: promise => promise }, './session-lifecycle': { sessionEpoch: () => 1 },
    './burrow-game-room-content': content,
  });
  assert.equal((await api.gameOverview()).games, content.GAME_ROOM_GAMES);
  assert.equal((await api.gameSession(progress.id)).questions, game.questions);
  assert.ok(requests.every(url => url.includes('content=local&catalogVersion=1')));
});

test('server strips static content only for new clients and guards catalogue compatibility', async () => {
  const helper = load('apps/api/src/lib/burrow-game-room.mjs');
  let state = { paired: true, ownedIds: [], availableIds: [], sessions: [] };
  const route = load('apps/api/src/app/api/vnext/game-room/route.js', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options.status }) } },
    '@/data/burrow-game-room-v1.json': catalog, '@/lib/burrow-game-room.mjs': helper,
    '@/lib/burrow-game-history.mjs': load('apps/api/src/lib/burrow-game-history.mjs', { './burrow-game-room.mjs': helper }),
    '@/lib/push-notifications':{},
    '@/lib/app-major-update': { authenticatedUserId: async () => 'user', majorUpdateEnabled: async () => true,
      appMajorUpdateServiceClient: () => ({ rpc: async () => ({ data: state, error: null }),from:table=>{
        const result=table==='app_config'?{value:'live'}:catalog.games.map(game=>({metadata:{gameId:game.id},price:150,plus_only:false,status:'active',revision_id:'live'}));
        const chain={select(){return chain;},eq(){return chain;},single:async()=>({data:result}),then(resolve,reject){return Promise.resolve({data:result}).then(resolve,reject);}};return chain;
      } }), commandStatus: () => 400 },
  }, { URL });
  const get = query => route.GET({ url: `https://example.test/api/vnext/game-room?${query}` });
  assert.equal((await get('mode=overview')).body.games.length, 70);
  assert.equal((await get('mode=overview&content=local')).body.games, undefined);
  state = { ...progress, questions: game.questions.map(q => ({ options: q.options, self: q.self, partner: q.partner })) };
  assert.equal((await get(`mode=session&id=${progress.id}`)).body.questions.length, 6);
  const local = await get(`mode=session&id=${progress.id}&content=local&catalogVersion=1`);
  assert.equal(local.status, 200);
  assert.equal(local.body.questions, undefined);
  assert.equal(local.body.gameId, game.id);
  assert.equal((await get(`mode=session&id=${progress.id}&content=local&catalogVersion=999`)).status, 409);
  state = { ...state, questions: [] };
  assert.equal((await get(`mode=session&id=${progress.id}&content=local&catalogVersion=1`)).status, 409);
});

function screenHarness(initialSessionId, options = {}) {
  const react = hooks(), overview = deferred(), session = deferred();
  const checkout=require('./coin-purchase-test-mock.cjs')({manual:options.manual});
  let stateRequests = 0, cachedOverview = options.overview ?? null;
  let draft,localWrites=0;const viewed=options.viewed??new Set();
  const routes=[],gestures=[],alerts=[],toasts=[];let focused=true;
  const local={useLocalGames:()=>draft?[draft]:[],readLocalGame:(id)=>draft&&(draft.session.id===id||draft.sessionId===id)?draft:undefined,
    createLocalGame:(game,existing,settings)=>{if(draft)return draft.session;draft={id:'draft',sessionId:existing?.id,freeUnlock:settings?.freeUnlock,session:existing??content.localGameSession({...progress,id:'local:draft',gameId:game.id})};return draft.session;},
    saveLocalGameAnswer:(id,phase,index,choice)=>{localWrites++;const field=phase==='own'?'ownAnswers':'guesses';draft.session={...draft.session,[field]:[...draft.session[field],choice]};return draft.session;},
    projectGameOverview:value=>value,reconcileLocalGame:value=>value,resumeLocalGames:async()=>{},retryLocalGame(){},
    gameResultViewed:id=>viewed.has(id),markGameResultViewed:id=>viewed.add(id)};
  const jsx = (type, props) => ({ type, props });
  const screen = load('apps/mobile/src/components/burrow/game-room-screen.tsx', {
    '@/lib/burrow-toast':{showBurrowToast:message=>toasts.push(message)},
    '../../../assets/burrow-webp/game room/waiting-page.webp':4,
    '@/components/ui/user-avatar':{UserAvatar:'UserAvatar'},
    '@/lib/burrow-page-entry':{openPreparedBurrow:r=>routes.push(r)},
    ...checkout.imports,
    '@/lib/insufficient-coins':load('apps/mobile/src/lib/insufficient-coins.ts',{'expo-router':{router:{navigate:href=>routes.push(href)}}}),
    '@expo/vector-icons':{Feather:'Icon',MaterialCommunityIcons:'MaterialIcon'},'@/lib/haptics':{haptics:{selection:async()=>{}}},
    '@/components/main/reflect-celebration':{ReflectCelebration:'Confetti'},
    './adventure-stage-transition':{AdventureStageTransition:'Transition'},'./game-round-art':{GameRoundArt:'Art'},
    '@/lib/burrow-game-local':local,
    '@/lib/use-page-back-gesture':{usePageBackGesture:enabled=>gestures.push(enabled)},
    './coin-ui': { CoinLabel: 'Text' },
    ...require('./burrow-attention-test-mocks.cjs'),
    '@/lib/partner-pairing':{requirePartner:data=>{if(data?.partner)return false;routes.push('/(main)/pair-partner');return true;}},
    '@react-navigation/native': { useIsFocused: () => focused },
    react: react.react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'Image', 'ImageBackground', 'Modal', 'Pressable', 'ScrollView', 'FlatList', 'Text', 'View'].map(name => [name, name])),
      StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: options.width ?? 375,height:options.height??812 }), Alert: { alert:(...args)=>alerts.push(args) }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { router: { push:href=>routes.push(href), back:()=>routes.push('back') } }, 'react-native-safe-area-context': { useSafeAreaInsets: () => options.insets??({ top: 20, bottom: 0 }) },
    '@/lib/burrow-game-room-api': { GAME_UNLOCK_PRICE:150,gameOverview: () => { stateRequests++; return options.initialGameId&&options.overview?Promise.resolve({...options.overview,products:options.overview.products??Object.fromEntries(content.GAME_ROOM_GAMES.map(g=>[g.id,{price:150,plus_only:false,active:true}]))}):overview.promise; }, gameSession: () => session.promise, ...options.api },
    '@/lib/burrow-game-room-art': { gameRoomBackground: 1, gameRoomIcons: {} },
    './burrow-image': { Image: 'Image' },
    '@/lib/burrow-store': { useBurrow: () => ({ data: {catalogComplete:!options.priceUnknown,profile:{id:'a'},partner:options.unpaired?null:{id:'b',display_name:'Alex'},pairVersion:'v1',hasPlus:options.hasPlus??false,catalog:options.catalog??content.GAME_ROOM_GAMES.map(g=>({stable_id:'game:'+g.id,item_type:'game',price:options.overview?.products?.[g.id]?.price??150,plus_only:options.overview?.products?.[g.id]?.plus_only??false})),wallet:{balance:options.balance??1000}} }), refreshBurrow: async () => {} },
    '@/lib/burrow-products':load('apps/mobile/src/lib/burrow-products.ts'),
    '@/lib/notification-settings': {}, '@/lib/burrow-ui-assets': { BURROW_GAME_RULE_ICONS: [1, 2, 3] }, './burrow-back-button': { BurrowBackButton: 'BackButton' },
    '@/lib/session-lifecycle': { sessionEpoch: () => 1, subscribeSessionIdentity: () => () => {} },
    '@/lib/burrow-game-room-cache': { subscribeGameRoomChanges: fn => { options.onGameChanged = fn; return () => { options.onGameChanged = null; }; }, getCachedGameOverview: () => cachedOverview, getCachedGameSession: id => options.cachedSessions?.get(id) ?? options.session ?? null,
      gameOverviewNeedsRefresh: () => options.staleOverview??!options.overview, gameSessionNeedsRefresh: () => !options.session,
      cacheGameOverview: value => { cachedOverview = value; }, cacheGameSession(value) { options.cachedSessions?.set(value.id,value); } },
    '@/lib/burrow-game-room-content': content,
    '@/lib/burrow-game-card-state':load('apps/mobile/src/lib/burrow-game-card-state.ts'),
  }, { setInterval: () => 1, clearInterval() {},setTimeout,clearTimeout,Error, ...options.globals });
  const render = () => react.render(() => screen.GameRoomScreen({ initialSessionId,initialGameId:options.initialGameId,fromHistory:!!options.fromHistory }));
  return { render, overview, session, unmount: react.unmount, stateRequests: () => stateRequests,localWrites:()=>localWrites,
    confirm:value=>{if(draft)draft.session=value;else options.session=value;},routes,gestures,viewed,alerts,
    draft:()=>draft,setFocused:value=>{focused=value;},setCachedOverview:value=>{cachedOverview=value;},checkout,toasts };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.ListHeaderComponent), ...nodes(tree.props?.ListFooterComponent),
    ...(tree.type==='FlatList'?(tree.props.data??[]).flatMap((item,index)=>nodes(tree.props.renderItem?.({item,index}))):[])];
}
test('Game from requires both partner sets complete; own zero-answer draft is Continue, not an invitation',()=>{
 for(const [partnerOwnCount,partnerGuessCount,expected] of [[0,0,false],[6,0,false],[6,5,false],[6,6,true]]){
  const value=content.localGameSession({...progress,partnerOwnCount,partnerGuessCount});
  const overview={paired:true,ownedIds:[game.id],availableIds:[game.id],sessions:[{id:value.id,gameId:game.id,createdAt:'now',completedAt:null,
   ownCount:0,guessCount:0,partnerOwnCount,partnerGuessCount}]};
  const h=screenHarness(undefined,{overview,cachedSessions:new Map([[value.id,value]])});
  const tree=JSON.stringify(h.render());assert.equal(tree.includes('Game from Alex'),expected);
  assert.equal(tree.includes('Continue your game'),!expected);h.unmount();
 }
});
test('history results never mount confetti; live results retain celebration and aligned compact green/red markers',()=>{
 const result={...content.localGameSession(progress),ownAnswers:Array(6).fill(0),guesses:[0,1,0,1,0,1],partnerOwnCount:6,partnerGuessCount:6,
  partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(0),completedAt:'2026-10-22',result:{mine:3,partner:6,outcome:'lose'}};
 for(const fromHistory of [false,true]){
  const h=screenHarness(result.id,{session:result,fromHistory});const tree=nodes(h.render());assert.equal(tree.some(n=>n.type==='Confetti'),!fromHistory);
  const labels=tree.filter(n=>n.type==='View'&&Array.isArray(n.props?.children)&&n.props.children.some(c=>c?.type==='Text'&&c.props.children==='You guessed'));
  assert.equal(labels.length,6);assert.ok(labels.every(row=>row.props.style.height===20));
  const marks=tree.filter(n=>n.type?.name==='Check'&&n.props.compact);assert.equal(marks.length,6);
  const numbers=tree.filter(n=>n.type?.name==='Avatar'&&n.props.small);assert.equal(numbers.length,6);
  for(const number of numbers){const view=number.type(number.props),style=Object.assign({},...view.props.style.filter(Boolean));assert.equal(style.backgroundColor,'#FFC547');assert.equal(style.width,36);assert.match(number.props.name,/^0[1-6]$/);}
  for(const mark of marks){const view=mark.type(mark.props),style=Object.assign({},...view.props.style.filter(Boolean));assert.equal(style.width,18);assert.equal(view.props.children.props.size,13);assert.equal(style.backgroundColor,mark.props.correct?'#388A54':'#E96566');}
  h.unmount();
 }
});
test('rules page prefetches missing old-round answers before Start; cached progress paints without an opening state',async()=>{
 const cache=new Map(),overview=content.localGameOverview({paired:true,availableIds:[game.id],sessions:[{...progress,createdAt:'2026-10-22',ownCount:2,guessCount:0}]});
 const h=screenHarness(undefined,{initialGameId:game.id,overview,cachedSessions:cache});h.render();
 h.session.resolve(content.localGameSession({...progress,ownAnswers:[1,2]}));await flush();assert.ok(cache.get(progress.id));
 nodes(h.render()).find(n=>n.props?.label==='Start Game').props.onPress();const tree=nodes(h.render());
 assert.ok(tree.some(n=>n.props?.children===game.questions[2].self));assert.ok(!tree.some(n=>n.props?.children==='Your saved round will appear here.'));h.unmount();
});
test('locked catalogue game confirms in place, never opens or creates a round before the verified unlock',async()=>{
 for(const approve of [false,true]){
  let charges=0;const overview=content.localGameOverview({paired:true,availableIds:[]});
  const h=screenHarness(undefined,{manual:true,overview,api:{gameOverview:async()=>({...overview,products:{[game.id]:{price:150,active:true,plus_only:false}}}),unlockGame:async()=>{charges++;return {charged:true};}}});
  const tile=nodes(h.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===game.id);
  tile.props.onSelect(tile.props.game);tile.props.onSelect(tile.props.game);
  assert.equal(h.checkout.offers.length,1,'prompt is immediate, not behind a network read');assert.equal(charges,0);
  assert.equal(h.routes.length,0);assert.equal(h.draft(),undefined);
  h.checkout.approval.resolve(approve);await flush();
  assert.equal(charges,approve?1:0);assert.equal(h.routes.length,approve?1:0);
  if(approve)assert.equal(h.routes[0].params.gameId,game.id);
  assert.equal(h.draft(),undefined,'the purchased rules page still requires explicit Start Game');h.unmount();
 }
});
test('waiting page uses a genuine one-at-a-time Nudge, with no local notification permission request',async()=>{
 const pending=deferred(),calls=[],round={...content.localGameSession(progress),ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0)};
 const h=screenHarness(progress.id,{session:round,api:{nudgeGame:async id=>{calls.push(id);return pending.promise;}}});
 const button=nodes(h.render()).find(n=>n.props?.label==='Nudge Alex to play');assert.ok(button);
 button.props.onPress();button.props.onPress();await flush();assert.deepEqual(calls,[progress.id]);
 pending.resolve({alreadySent:true});await flush();assert.deepEqual(h.toasts,['You’ve already nudged them today.']);
 assert.equal(h.alerts.length,0);h.unmount();
});
test('new rules, phase artwork, flat background and complete result comparison remain consistent on compact and tall screens',()=>{
 for(const [width,height]of [[320,568],[390,844],[430,932]]){
  const overview=content.localGameOverview({availableIds:[game.id]});
  const h=screenHarness(undefined,{initialGameId:game.id,overview,width,height});
  let tree=nodes(h.render());assert.equal(tree[0].props.style.backgroundColor,'#492817');
  assert.ok(tree.some(n=>n.props?.label==='Start Game'));assert.ok(!tree.some(n=>n.type==='Art'));
  h.unmount();
  const result={...content.localGameSession(progress),ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnCount:6,partnerGuessCount:6,
   partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(1),completedAt:'2026-10-21',result:{mine:6,partner:0,outcome:'win'}};
  const done=screenHarness(progress.id,{session:result,width,height});tree=nodes(done.render());
  assert.ok(tree.some(n=>n.type==='Image'&&n.props.source===3));
  assert.equal(tree.filter(n=>n.props?.children==='You guessed').length,6);
  assert.ok(tree.some(n=>Array.isArray(n.props?.children)&&n.props.children.join('')==='How well you know Alex'));
  assert.ok(tree.some(n=>n.props?.label==='Done'));assert.equal(tree.filter(n=>n.type==='UserAvatar').length,2);done.unmount();
 }
});
test('every category places Admin Plus-exclusive games last for Free and Plus members alike',()=>{
  const products=content.GAME_ROOM_GAMES.map((g,index)=>({stable_id:'game:'+g.id,item_type:'game',price:150,plus_only:index%3===0}));
  for(const hasPlus of [false,true]){
    const h=screenHarness(undefined,{hasPlus,catalog:products});
    const rails=nodes(h.render()).filter(n=>n.type==='FlatList'&&n.props.horizontal);
    assert.equal(rails.length,7);
    const originals=content.GAME_ROOM_CATEGORIES.map(category=>content.GAME_ROOM_GAMES.filter(g=>g.category===category));
    const plusIds=new Set(products.filter(p=>p.plus_only).map(p=>p.stable_id.slice(5)));
    rails.forEach((rail,index)=>{
      const original=originals[index];
      const expected=[...original.filter(g=>!plusIds.has(g.id)),...original.filter(g=>plusIds.has(g.id))].map(g=>g.id);
      assert.deepEqual(Array.from(rail.props.data,g=>g.id),expected);
    });
    h.unmount();
  }
});
test('first frame uses bootstrap Admin prices/Plus even when the game overview has stale conflicting offers',()=>{
 const id=content.GAME_ROOM_GAMES[0].id,overview=content.localGameOverview({products:{[id]:{price:150,plus_only:false,active:true}}});
 const h=screenHarness(undefined,{overview,catalog:[{stable_id:'game:'+id,item_type:'game',price:875,plus_only:true}]});
 const tile=nodes(h.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===id);
 assert.equal(tile.props.state.kind,'plus');assert.equal(tile.props.game.price,875);assert.equal(tile.props.game.plus_only,true);h.unmount();
});
test('an unverified cold snapshot never paints fallback coin/Plus tiles while the initial bootstrap is in flight',()=>{
 const h=screenHarness(undefined,{priceUnknown:true});const tree=nodes(h.render());
 assert.equal(tree.filter(n=>n.type?.name==='GameTile').length,0);
 assert.ok(tree.some(n=>n.props?.children==='Preparing your games…'));h.unmount();
});
test('catalogue cards render coin price, crown Plus badge, and two independent completion checks',()=>{
  const first=content.GAME_ROOM_GAMES[0],second=content.GAME_ROOM_GAMES[1],third=content.GAME_ROOM_GAMES[2];
  const overview=content.localGameOverview({availableIds:[third.id],products:Object.fromEntries(content.GAME_ROOM_GAMES.map(g=>[g.id,{price:210,plus_only:g.id===second.id,active:true}])),
    sessions:[{id:progress.id,gameId:third.id,createdAt:'2026-10-13',completedAt:null,ownCount:0,guessCount:0,partnerOwnCount:6,partnerGuessCount:6}]});
  const h=screenHarness(undefined,{overview}),tiles=nodes(h.render()).filter(n=>n.type?.name==='GameTile');
  const draw=id=>tiles.find(tile=>tile.props.game.id===id).type(tiles.find(tile=>tile.props.game.id===id).props);
  assert.ok(nodes(draw(first.id)).some(n=>n.props?.children==='{coin} 210'));
  assert.ok(nodes(draw(second.id)).some(n=>n.type==='MaterialIcon'&&n.props.name==='crown'));
  const checks=nodes(draw(third.id)).filter(n=>/^You |^Partner /.test(n.props?.accessibilityLabel??''));
  assert.equal(checks.length,2);assert.equal(checks[0].props.style.filter(Boolean).at(-1).backgroundColor,'#AA9B82');assert.equal(checks[1].props.style.filter(Boolean).at(-1).backgroundColor,'#FF7920');
  h.unmount();
});
test('Plus gate opens paywall directly; Plus members see the price or unlocked checks',()=>{
  const overview=content.localGameOverview({products:Object.fromEntries(content.GAME_ROOM_GAMES.map(g=>[g.id,{price:310,plus_only:true,active:true}]))});
  const free=screenHarness(undefined,{overview}),tile=nodes(free.render()).find(n=>n.type?.name==='GameTile');
  tile.props.onSelect(tile.props.game);tile.props.onSelect(tile.props.game);
  assert.equal(free.routes[0],'/(main)/(modals)/subscription-paywall');assert.equal(free.routes.length,1);free.unmount();
  const plus=screenHarness(undefined,{overview,hasPlus:true}),owned=nodes(plus.render()).find(n=>n.type?.name==='GameTile');
  assert.equal(owned.props.state.kind,'locked');assert.equal(owned.props.state.price,310);
  owned.props.onSelect(owned.props.game);assert.equal(plus.routes.length,0);assert.equal(plus.checkout.offers.length,1);plus.unmount();
});
test('unpaired users see the shared invitation on every game card, before Plus/unlock/results navigation',()=>{
  const first=content.GAME_ROOM_GAMES[0],second=content.GAME_ROOM_GAMES[1],third=content.GAME_ROOM_GAMES[2];
  const overview=content.localGameOverview({availableIds:[third.id],products:Object.fromEntries(content.GAME_ROOM_GAMES.map(g=>[g.id,{price:210,plus_only:g.id===second.id,active:true}]))});
  const h=screenHarness(undefined,{overview,unpaired:true});
  for(const id of [first.id,second.id,third.id]){
    const tile=nodes(h.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===id);tile.props.onSelect(tile.props.game);
  }
  assert.deepEqual(h.routes,['/(main)/pair-partner','/(main)/pair-partner','/(main)/pair-partner']);assert.equal(h.alerts.length,0);assert.equal(h.localWrites(),0);h.unmount();
});
test('Games preflight to Oops only for paid unlocks; already-unlocked play remains free even at zero balance',async()=>{
 let charges=0;
 const poor=screenHarness(undefined,{initialGameId:game.id,balance:0,overview:content.localGameOverview({paired:true,availableIds:[]}),api:{unlockGame:()=>{charges++;}}});
 nodes(poor.render()).find(n=>n.props?.label==='Start Game').props.onPress();
 await flush();
 assert.deepEqual(poor.routes,['/(main)/insufficient-coins']);assert.equal(poor.alerts.length,0);assert.equal(charges,0);poor.unmount();
 const owned=screenHarness(undefined,{initialGameId:game.id,balance:0,overview:content.localGameOverview({paired:true,availableIds:[game.id]}),api:{unlockGame:()=>{charges++;}}});
 nodes(owned.render()).find(n=>n.props?.label==='Start Game').props.onPress();
 assert.equal(owned.routes.length,0);assert.equal(owned.alerts.length,0);assert.equal(charges,0);assert.ok(owned.draft());owned.unmount();
});
test('Games stale-balance unlock failure uses Oops and clears the unlock spinner without starting a round',async()=>{
 const h=screenHarness(undefined,{initialGameId:game.id,overview:content.localGameOverview({paired:true,availableIds:[]}),api:{unlockGame:async()=>{throw Error('insufficient_balance');}}});
 nodes(h.render()).find(n=>n.props?.label==='Start Game').props.onPress();
 await flush();
 assert.deepEqual(h.routes,['/(main)/insufficient-coins']);assert.equal(h.draft(),undefined);
 assert.ok(nodes(h.render()).some(n=>n.props?.label==='Start Game'));h.unmount();
});
test('game unlock waits for one explicit confirmation; cancellation cannot charge or start a round',async()=>{
 for(const approved of [false,true]){
  let charges=0;const h=screenHarness(undefined,{manual:true,initialGameId:game.id,overview:content.localGameOverview({paired:true,availableIds:[]}),api:{unlockGame:async()=>{charges++;}}});
  const button=nodes(h.render()).find(n=>n.props?.label==='Start Game');button.props.onPress();button.props.onPress();await flush();
  assert.equal(h.checkout.offers.length,1);assert.equal(charges,0);assert.equal(h.draft(),undefined);
  h.checkout.approval.resolve(approved);await flush();assert.equal(charges,approved?1:0);
  assert.equal(!!h.draft(),approved);assert.equal(h.checkout.successes.length,0);h.unmount();
 }
});
test('free tiles use standard grey/orange completion checks before and after shared unlock, never a Free label',()=>{
 for(const availableIds of [[],[game.id]])for(const [ownCount,guessCount,partnerOwnCount,partnerGuessCount,mine,partner] of [
  [0,0,0,0,false,false],[6,0,0,0,false,false],[6,6,0,0,true,false],[0,0,6,6,false,true],[6,6,6,6,true,true],
 ]){
  const sessions=ownCount||guessCount||partnerOwnCount||partnerGuessCount?[{id:progress.id,gameId:game.id,createdAt:'2026-10-15',completedAt:null,ownCount,guessCount,partnerOwnCount,partnerGuessCount}]:[];
  const h=screenHarness(undefined,{overview:content.localGameOverview({paired:true,availableIds,sessions,products:{[game.id]:{price:0,plus_only:false,active:true}}})});
  const tile=nodes(h.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===game.id),drawn=nodes(tile.type(tile.props));
  assert.ok(!drawn.some(n=>n.type==='Text'&&n.props.children==='Free'));
  assert.ok(!drawn[0].props.accessibilityLabel.includes('Free'));
  const checks=drawn.filter(n=>/^You |^Partner /.test(n.props?.accessibilityLabel??''));
  assert.equal(checks.length,2);
  for(const [index,done]of [mine,partner].entries()){
   assert.equal(checks[index].props.accessibilityLabel,(index===0?'You':'Partner')+(done?' finished':' not finished'));
   const style=Object.assign({},...checks[index].props.style.flat().filter(Boolean));
   assert.equal(style.width,24);assert.equal(style.height,24);
   assert.equal(style.backgroundColor,done?'#FF7920':'#AA9B82');
  }
  assert.ok(!drawn.some(n=>String(n.props?.children).includes('{coin} 0')));h.unmount();
 }
});
test('private realtime invalidation refreshes a focused lobby immediately and detaches on exit',async()=>{
 const options={overview:content.localGameOverview({paired:true,availableIds:[game.id]})};
 const h=screenHarness(undefined,options);h.render();h.overview.resolve(options.overview);await flush();h.render();const before=h.stateRequests();
 assert.equal(typeof options.onGameChanged,'function');options.onGameChanged();assert.equal(h.stateRequests(),before+1);
 h.setFocused(false);h.render();assert.equal(options.onGameChanged,null);
 h.setFocused(true);h.render();assert.equal(typeof options.onGameChanged,'function');
 h.unmount();assert.equal(options.onGameChanged,null);
});
test('broadcast bursts during an old overview read collapse into one trailing refresh, never a parallel request pile',async()=>{
 const options={overview:content.localGameOverview({paired:true,availableIds:[game.id]}),staleOverview:true};
 const h=screenHarness(undefined,options);h.render();assert.equal(h.stateRequests(),0,'focus revalidation is outside the initial navigation frame');await flush();assert.equal(h.stateRequests(),1);
 for(let i=0;i<20;i++)options.onGameChanged();assert.equal(h.stateRequests(),1);
 h.overview.resolve(options.overview);await flush();assert.equal(h.stateRequests(),2);
 h.unmount();
});
test('fresh cached lobby opens and refocuses without another read, but private invalidation bypasses TTL',async()=>{
 const options={overview:content.localGameOverview({paired:true,availableIds:[game.id]})},h=screenHarness(undefined,options);
 h.render();await flush();assert.equal(h.stateRequests(),0);
 h.setFocused(false);h.render();h.setFocused(true);h.render();await flush();assert.equal(h.stateRequests(),0);
 options.onGameChanged();assert.equal(h.stateRequests(),1);h.overview.resolve(options.overview);await flush();h.unmount();
});
test('game art warmup covers the viewport on short/tall phones without warming every below-fold rail',()=>{
 const layout=load('apps/mobile/src/lib/game-room-layout.ts');
 for(const [width,height] of [[320,568],[390,844],[440,956],[768,1024]]){
  const body=height-102,count=layout.gameRoomInitialRows(width,body,7);
  assert.ok(count*(Math.max(118,layout.gameRoomTileWidth(width)*1.24)+65)>=body);
  assert.ok(count<7);assert.ok(count>=2);
 }
});
test('persisted completion projects through local catalogue hydration with current Admin prices and Plus flags',()=>{
 const completion={[game.id]:{mineFinished:true,partnerFinished:true}};
 const overview=content.localGameOverview({paired:true,availableIds:[game.id],completion,
  products:{[game.id]:{price:300,plus_only:false,active:true}}});
 assert.equal(overview.completion,completion);
 const h=screenHarness(undefined,{overview}),tile=nodes(h.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===game.id);
 assert.equal(tile.props.state.mineFinished,true);assert.equal(tile.props.state.partnerFinished,true);
 assert.equal(tile.props.game.price,300);h.unmount();
});
test('a free route shows rules until Start, then opens locally without waiting for the zero-price receipt',async()=>{
 const calls=[],pending=deferred(),h=screenHarness(undefined,{initialGameId:game.id,balance:0,
  overview:content.localGameOverview({paired:true,availableIds:[],products:{[game.id]:{price:0,plus_only:false,active:true}}}),
  api:{unlockGame:async(...args)=>{calls.push(args);return pending.promise;}}});
 let tree=h.render();h.render();assert.deepEqual(calls,[]);assert.equal(h.checkout.offers.length,0);
 assert.ok(nodes(tree).some(n=>n.props?.children==='Answer all 6 questions about yourself'));assert.equal(h.draft(),undefined);
 const start=nodes(tree).find(n=>n.props?.label==='Start Game');start.props.onPress();start.props.onPress();tree=h.render();assert.deepEqual(calls,[]);
 assert.ok(h.draft().freeUnlock);assert.ok(nodes(tree).some(n=>n.props?.children===game.questions[0].self));assert.ok(!nodes(tree).some(n=>n.props?.label==='Opening…'));
 pending.resolve({unlocked:true,charged:false});await flush();tree=h.render();
 assert.ok(h.draft());assert.equal(h.checkout.successes.length,0);assert.equal(h.routes.length,0);
 assert.ok(nodes(tree).some(n=>n.props?.children===game.questions[0].self));h.render();assert.equal(calls.length,0);h.unmount();
});
test('shared free unlock enters locally without another server unlock; free never bypasses pairing or Plus',async()=>{
 const offer={price:0,plus_only:false,active:true};let calls=0;
 const owned=screenHarness(undefined,{initialGameId:game.id,balance:0,overview:content.localGameOverview({paired:true,availableIds:[game.id],products:{[game.id]:offer}}),api:{unlockGame:async()=>{calls++;}}});
 let tree=owned.render();assert.equal(owned.draft(),undefined);assert.ok(nodes(tree).some(n=>n.props?.children==='Compare answers and see who won!'));
 nodes(tree).find(n=>n.props?.label==='Start Game').props.onPress();assert.ok(owned.draft());assert.equal(calls,0);assert.equal(owned.checkout.offers.length,0);owned.unmount();
 for(const options of [{unpaired:true},{hasPlus:false}]){
  const h=screenHarness(undefined,{...options,initialGameId:game.id,overview:content.localGameOverview({availableIds:[],products:{[game.id]:{...offer,plus_only:!options.unpaired}}}),api:{unlockGame:async()=>{calls++;}}});
  const button=nodes(h.render()).find(n=>n.type?.name==='Button'&&/Start|Join Plus/.test(n.props.label));button.props.onPress();
  assert.equal(h.routes[0],options.unpaired?'/(main)/pair-partner':'/(main)/(modals)/subscription-paywall');
  assert.equal(h.draft(),undefined);assert.equal(h.checkout.offers.length,0);h.unmount();
 }assert.equal(calls,0);
});
test('a free start never performs checkout or navigation from the screen, including after focus loss',async()=>{
 for(const leave of [true,false]){
  let calls=0;const h=screenHarness(undefined,{initialGameId:game.id,
   overview:content.localGameOverview({paired:true,availableIds:[],products:{[game.id]:{price:0,plus_only:false,active:true}}}),
   api:{unlockGame:async()=>{calls++;throw Error('must use durable background queue');}}});
  nodes(h.render()).find(n=>n.props?.label==='Start Game').props.onPress();if(leave){h.setFocused(false);h.render();}
  await flush();h.render();assert.equal(calls,0);assert.equal(h.draft().freeUnlock,true);assert.equal(h.routes.length,0);
  assert.equal(h.checkout.offers.length,0);assert.equal(h.checkout.successes.length,0);
  h.unmount();
 }
});
test('free entry retains its local question after focus returns, without waiting or opening checkout',async()=>{
 const products={[game.id]:{price:0,plus_only:false,active:true}};
 const pending=deferred();let calls=0;const options={initialGameId:game.id,overview:content.localGameOverview({paired:true,availableIds:[],products}),
  api:{unlockGame:async()=>{calls++;return pending.promise;}}};
 const h=screenHarness(undefined,options);nodes(h.render()).find(n=>n.props?.label==='Start Game').props.onPress();h.setFocused(false);h.render();pending.resolve({unlocked:true});await flush();
 assert.ok(h.draft());h.setFocused(true);let tree=h.render();await flush();tree=h.render();assert.equal(calls,0);
 assert.ok(nodes(tree).some(n=>n.props?.children===game.questions[0].self));assert.equal(h.checkout.offers.length,0);h.unmount();
});
test('repriced games preserve known shared unlocks at zero balance, while a stale ownership cache is checked before checkout',async()=>{
 const offer={price:300,plus_only:false,active:true},products={[game.id]:offer};let charges=0;
 for(const known of [true,false]){
  const overview=content.localGameOverview({paired:true,availableIds:known?[game.id]:[],products});
  const h=screenHarness(undefined,{initialGameId:game.id,balance:0,overview,api:{
   gameOverview:async()=>({...overview,availableIds:[game.id]}),unlockGame:async()=>{charges++;}}});
  const label='Start Game';
  nodes(h.render()).find(n=>n.props?.label===label).props.onPress();await flush();h.render();
  assert.ok(h.draft());assert.equal(h.checkout.offers.length,known?0:1);assert.equal(h.checkout.successes.length,0);assert.equal(h.routes.length,0);h.unmount();
 }assert.equal(charges,0);
});
test('returning from a child game paints the confirmed unlock from the shared cache on the first frame, without awaiting a poll',()=>{
 const overview=content.localGameOverview({paired:true,availableIds:[],products:{[game.id]:{price:300,plus_only:false,active:true}}});
 const h=screenHarness(undefined,{overview});h.render();h.setFocused(false);h.render();
 h.setCachedOverview({...overview,availableIds:[game.id],ownedIds:[game.id]});h.setFocused(true);
 const tile=nodes(h.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===game.id);assert.equal(tile.props.state.kind,'unlocked');h.unmount();
});
test('a never-unlocked repriced game shows its real price and requires confirmation; only a charged receipt produces a purchase toast',async()=>{
 for(const charged of [true,false]){
  const overview=content.localGameOverview({paired:true,availableIds:[],products:{[game.id]:{price:300,plus_only:false,active:true}}});
  const calls=[],h=screenHarness(undefined,{manual:true,initialGameId:game.id,overview,api:{unlockGame:async(...args)=>{calls.push(args);return {charged};}}});
  const button=nodes(h.render()).find(n=>n.props?.label==='Start Game');button.props.onPress();await flush();
  assert.equal(h.checkout.offers[0].price,300);assert.equal(calls.length,0);assert.equal(h.draft(),undefined);
  h.checkout.approval.resolve(true);await flush();h.render();assert.deepEqual(calls,[[game.id,300]]);
  assert.equal(h.checkout.successes.length,0);assert.ok(h.draft());h.unmount();
 }
});
test('a local zero-price start queues only a free intent and never authorizes a paid checkout',async()=>{
 const current=content.localGameOverview({paired:true,availableIds:[],products:{[game.id]:{price:300,plus_only:false,active:true}}});
 const calls=[],options={manual:true,initialGameId:game.id,catalog:[{stable_id:'game:'+game.id,item_type:'game',price:0,plus_only:false}],
  overview:content.localGameOverview({paired:true,availableIds:[],products:{[game.id]:{price:0,plus_only:false,active:true}}}),
  api:{gameOverview:async()=>current,unlockGame:async(id,price)=>{calls.push([id,price]);if(price===0)throw Error('price_changed');return {charged:true};}}};
 const h=screenHarness(undefined,options);nodes(h.render()).find(n=>n.props?.label==='Start Game').props.onPress();await flush();h.render();
 assert.deepEqual(calls,[]);assert.equal(h.checkout.offers.length,0);assert.equal(h.draft().freeUnlock,true);h.unmount();
});
test('completed catalogue tile opens rules without a session shortcut; dedicated results and replay stay free',()=>{
  const done={...content.localGameSession(progress),ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnCount:6,partnerGuessCount:6,
    partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(1),completedAt:'2026-10-13',result:{mine:6,partner:0,outcome:'win'}};
  const row={id:done.id,gameId:game.id,createdAt:'2026-10-13',completedAt:done.completedAt,resultViewedAt:'2026-10-13',ownCount:6,guessCount:6,partnerOwnCount:6,partnerGuessCount:6};
  const overview=content.localGameOverview({availableIds:[game.id],sessions:[row]}),lobby=screenHarness(undefined,{overview});
  const tile=nodes(lobby.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===game.id);
  assert.equal(tile.props.state.mineFinished,true);assert.equal(tile.props.state.partnerFinished,true);
  assert.ok(!nodes(lobby.render()).some(n=>n.props?.accessibilityLabel?.startsWith('Check ')));
  tile.props.onSelect(tile.props.game);assert.equal(lobby.routes[0].params.gameId,game.id);assert.equal(lobby.routes[0].params.sessionId,undefined);lobby.unmount();
  const intro=screenHarness(undefined,{initialGameId:game.id,overview});
  assert.ok(nodes(intro.render()).some(n=>n.props?.label==='Start Game'));assert.equal(intro.draft(),undefined);intro.unmount();
  let charges=0;const child=screenHarness(done.id,{session:done,overview,api:{unlockGame:()=>{charges++;throw Error('repeat charge');}}});
  let tree=child.render();assert.ok(nodes(tree).some(n=>n.props?.children==='You win!'));
  assert.ok(!nodes(tree).some(n=>n.props?.label==='Play again →'));
  nodes(tree).find(n=>n.props?.label==='Done').props.onPress();
  assert.equal(charges,0);assert.deepEqual(child.routes,['back']);child.unmount();
});
test('all unseen results stay at the top; waiting for partner is not mislabeled as a half-played game',()=>{
  const rows=Array.from({length:3},(_,i)=>({id:'done-'+i,gameId:game.id,createdAt:'2026-10-13',completedAt:'2026-10-13',ownCount:6,guessCount:6,partnerOwnCount:6,partnerGuessCount:6}));
  rows.push({id:'waiting',gameId:game.id,createdAt:'2026-10-13',completedAt:null,ownCount:6,guessCount:6,partnerOwnCount:0,partnerGuessCount:0});
  const cachedSessions=new Map(rows.filter(row=>row.completedAt).map(row=>[row.id,{...content.localGameSession(progress),id:row.id,result:{mine:6,partner:0,outcome:'win'}}]));
  const h=screenHarness(undefined,{overview:content.localGameOverview({sessions:rows}),cachedSessions}),tree=nodes(h.render());
  assert.equal(tree.filter(n=>n.props?.accessibilityLabel?.startsWith('Check ')).length,3);
  assert.ok(tree.some(n=>n.props?.children==='Waiting for Alex'));assert.ok(!tree.some(n=>n.props?.children==='Continue your game'));h.unmount();
});

test('an overview alone cannot expose a result entrance before its full result is cached',()=>{
  const row={id:'prepared-result',gameId:game.id,createdAt:'2026-10-13',completedAt:'2026-10-13',ownCount:6,guessCount:6,partnerOwnCount:6,partnerGuessCount:6};
  const cachedSessions=new Map(),h=screenHarness(undefined,{overview:content.localGameOverview({sessions:[row]}),cachedSessions});
  assert.equal(nodes(h.render()).filter(n=>n.props?.accessibilityLabel?.startsWith('Check ')).length,0);
  cachedSessions.set(row.id,{...content.localGameSession(progress),id:row.id,result:{mine:6,partner:0,outcome:'win'}});
  assert.equal(nodes(h.render()).filter(n=>n.props?.accessibilityLabel?.startsWith('Check ')).length,1);h.unmount();
});

test('Game Room carries the full opaque background and header inside every page transition',()=>{
  for(const session of [undefined,{...content.localGameSession(progress),ownAnswers:[0,0,0,0,0,0],guesses:[0,0,0,0,0,0]}]){
    const h=screenHarness(session?.id,{session}),tree=h.render();
    const transition=nodes(tree).find(n=>n.type==='Transition');
    assert.equal(transition.props.nativePage,!session,'only lobby delegates its whole exit to the native navigator');
    assert.equal(transition.props.compact,undefined,'whole pages slide; compact motion belongs only to dialogue content');
    const page=transition.props.children;
    assert.equal(page.props.style.backgroundColor,'#492817');
    const children=nodes(page);
    assert.ok(!children.some(n=>n.type==='Image'&&n.props.pointerEvents==='none'));
    assert.ok(children.some(n=>n.type==='BackButton'),'header and back button move with the background');
    assert.equal(nodes(tree).filter(n=>n.type==='Image'&&n.props.pointerEvents==='none').length,0);
    h.unmount();
  }
});
test('catalogue keeps a small native entry batch even with prepared art, without any loading gate',()=>{
 for(const artReady of [false,true]){
  const h=screenHarness(undefined,{artReady}),tree=nodes(h.render());
  const list=tree.find(n=>n.type==='FlatList'&&!n.props.horizontal);
  assert.equal(list.props.initialNumToRender,2);
  assert.equal(tree.filter(n=>n.type==='ActivityIndicator').length,0);h.unmount();
 }
});

test('every game rail shows three complete cards and half of the fourth across screen sizes', () => {
  for (const width of [320, 375, 430, 768]) {
    const h = screenHarness(undefined, { width });
    const tree = h.render();
    const rails = nodes(tree).filter(node => ['ScrollView','FlatList'].includes(node.type) && node.props.horizontal);
    assert.equal(rails.length, 7); // Seven category rails; no duplicate Latest previews.
    for (const rail of rails) {
      const tiles = nodes(rail).filter(node => node.type?.name === 'GameTile');
      assert.ok(tiles.length >= 4);
      const cardWidth = tiles[0].props.width;
      const gap = rail.props.contentContainerStyle.gap;
      assert.ok(tiles.every(tile => tile.props.width === cardWidth));
      if(width<600)assert.ok(Math.abs((width - 18 - 3 * (cardWidth + gap)) / cardWidth - .5) < 1e-8);
      else assert.equal(cardWidth,150); // tablets retain comfortable card sizes
      assert.equal(rail.props.showsHorizontalScrollIndicator, false);
    }
    h.unmount();
  }
});

test('fresh install renders every game before the first state request resolves', async () => {
  const h = screenHarness(undefined,{staleOverview:true,overview:content.localGameOverview({availableIds:content.GAME_ROOM_GAMES.map(g=>g.id)})});
  let tree = h.render();
  assert.equal(h.stateRequests(), 0,'rendering never starts the optional focus read inline');
  await flush();assert.equal(h.stateRequests(),1);
  assert.equal(nodes(tree).filter(n => n.type === 'ActivityIndicator').length, 0);
  const tiles = nodes(tree).filter(n => n.type?.name === 'GameTile');
  assert.equal(tiles.length, 70);
  assert.equal(nodes(tree).some(n=>n.props?.children==='Latest'),false);
  assert.deepEqual(tiles.map(tile=>tile.props.game.id).sort(),content.GAME_ROOM_GAMES.map(game=>game.id).sort(),'all games remain available once in their categories');
  const title = nodes(tree).find(n => n.props?.children === 'Game Room');
  assert.equal(title.props.accessibilityRole, 'header');
  assert.equal(title.props.style.at(-1).textAlign, 'center');
  for (const tile of tiles) {
    const drawn = tile.type(tile.props);
    const icon = nodes(drawn).find(n => n.type === 'Image');
    assert.ok(Math.abs(icon.props.style.width - tile.props.width * .39) < 1e-8);
    assert.equal(icon.props.style.height, icon.props.style.width);
    assert.equal(icon.props.contentFit, 'contain');
    assert.equal(drawn.props.style({pressed:false})[0].alignItems, 'center');
    assert.equal(drawn.props.style({pressed:false})[0].justifyContent, 'space-between');
    const styles=drawn.props.style({pressed:false});
    assert.ok(styles[1].height>=styles[0].paddingVertical*2+icon.props.style.height+26+26,'icon, title and state row must fit without crowding');
  }
  tiles[0].props.onSelect(tiles[0].props.game);
  tree = h.render();
  assert.equal(nodes(tree).filter(n=>n.type?.name==='GameTile').length,70,'lobby remains mounted below the native game route');
  assert.deepEqual(JSON.parse(JSON.stringify(h.routes)),[{pathname:'/(main)/game-room',params:{gameId:tiles[0].props.game.id}}]);
  const child=screenHarness(undefined,{initialGameId:tiles[0].props.game.id});
  assert.ok(nodes(child.render()).some(n => n.props?.children === tiles[0].props.game.hook));
  assert.ok(nodes(child.render()).some(n => n.props?.label === 'Start Game'));child.unmount();
  h.overview.reject(new Error('offline'));
  await flush();
  tree = h.render();
  assert.equal(nodes(tree).filter(n => n.type === 'ActivityIndicator').length, 0);
  assert.ok(!nodes(tree).some(n => n.props?.children === 'offline'));
  h.unmount();
});

test('saved round renders its local question without waiting for overview revalidation', async () => {
  const h = screenHarness(progress.id);
  assert.equal(nodes(h.render()).filter(n => n.type === 'ActivityIndicator').length, 0);
  assert.ok(nodes(h.render()).some(n=>n.props?.children==='Your saved round will appear here.'));
  h.session.resolve(content.localGameSession(progress));
  await flush();
  const tree = h.render();
  assert.equal(nodes(tree).filter(n => n.type === 'ActivityIndicator').length, 0);
  assert.ok(nodes(tree).some(n => n.props?.children === game.questions[0].self));
  h.overview.reject(new Error('offline'));
  await flush();
  assert.ok(!nodes(h.render()).some(n => n.props?.children === 'offline'));
  h.unmount();
});

test('exiting during an answer cannot resurrect the round or dispatch duplicate answers', async () => {
  const time = clock(), saved = deferred(); let writes = 0;
  const round = content.localGameSession(progress);
  const h = screenHarness(progress.id, { session: round, overview: content.localGameOverview({ paired: true, availableIds: [game.id], sessions: [] }),
    globals: time.globals, api: { answerGame: () => { writes++; return saved.promise; } } });
  let tree = h.render();
  const answer = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('A. '));
  answer.props.onPress(); answer.props.onPress();
  time.advance(180); await flush(); assert.equal(writes, 0);assert.equal(h.localWrites(),1);
  tree = h.render(); nodes(tree).find(node => node.type === 'BackButton').props.onPress();
  assert.deepEqual(h.routes,['back']);
  assert.equal(h.draft().session.ownAnswers.length,1,'answer queue survives native exit');
  h.unmount();
  saved.resolve({ session: { ...round, ownAnswers: [0] } }); await flush();
  assert.deepEqual(h.routes,['back'],'late response cannot push another game');
});

test('an unlocked game shows rules; Start opens its local question immediately without a session request', async () => {
  let reads = 0;
  const overview=content.localGameOverview({ paired: true, availableIds: [game.id], sessions: [] });
  const h = screenHarness(undefined, { initialGameId:game.id,overview,
    api: { startGame: async () => ({ sessionId: progress.id, session: content.localGameSession(progress) }),
      gameSession: async () => { reads++; throw Error('extra read'); } } });
  let tree = h.render();assert.ok(nodes(tree).some(n=>n.props?.children==='Guess your partner’s answers'));
  assert.equal(h.draft(),undefined);nodes(tree).find(node => node.props?.label === 'Start Game').props.onPress();
  await flush(); tree = h.render();
  assert.equal(reads, 0); assert.ok(nodes(tree).some(node => node.props?.children === game.questions[0].self));
  h.unmount();
});
test('unlocked catalogue cards with an unfinished round still show rules; Start resumes cached progress without charging',()=>{
  for(const price of [0,210])for(const plus of [false,true]){
    const round=content.localGameSession({...progress,ownAnswers:[1,2]});
    const overview=content.localGameOverview({paired:true,availableIds:[game.id],sessions:[{
      id:round.id,gameId:game.id,createdAt:'2026-10-17',completedAt:null,ownCount:2,guessCount:0,partnerOwnCount:0,partnerGuessCount:0,
    }],products:{[game.id]:{price,plus_only:plus,active:true}}});
    const lobby=screenHarness(undefined,{overview,hasPlus:plus}),tile=nodes(lobby.render()).find(n=>n.type?.name==='GameTile'&&n.props.game.id===game.id);
    tile.props.onSelect(tile.props.game);assert.equal(lobby.routes[0].params.sessionId,undefined);assert.equal(lobby.routes[0].params.resumeSessionId,round.id);lobby.unmount();
    let charges=0;const child=screenHarness(undefined,{initialGameId:game.id,overview,hasPlus:plus,balance:0,session:round,api:{unlockGame:()=>{charges++;}}});
    let tree=child.render();assert.ok(nodes(tree).some(n=>n.props?.children==='Answer all 6 questions about yourself'));
    assert.equal(nodes(tree).some(n=>n.props?.children===game.questions[2].self),false);
    nodes(tree).find(n=>n.props?.label==='Start Game').props.onPress();tree=child.render();
    assert.ok(nodes(tree).some(n=>n.props?.children===game.questions[2].self));assert.equal(charges,0);assert.equal(child.checkout.offers.length,0);child.unmount();
  }
});

test('completed sender result is the first lobby entry and opens with confetti, not through History',()=>{
  const done={...content.localGameSession(progress),ownAnswers:Array(6).fill(0),guesses:Array(6).fill(0),partnerOwnCount:6,partnerGuessCount:6,
    partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(1),completedAt:'2026-10-12',result:{mine:6,partner:0,outcome:'win'}};
  const h=screenHarness(undefined,{session:done,overview:content.localGameOverview({paired:true,availableIds:[game.id],sessions:[{
    id:progress.id,gameId:game.id,createdAt:'2026-10-12',completedAt:'2026-10-12',ownCount:6,guessCount:6,partnerOwnCount:6,partnerGuessCount:6}]})});
  let tree=h.render();const entry=nodes(tree).find(n=>n.props?.accessibilityLabel?.startsWith('Check '));assert.ok(entry);
  assert.ok(nodes(tree).some(n=>n.props?.children==='Game result awaiting to be checked'));
  entry.props.onPress();assert.equal(h.routes[0].params.sessionId,progress.id);
  const child=screenHarness(progress.id,{session:done,viewed:h.viewed});tree=child.render();
  assert.ok(nodes(tree).some(n=>n.props?.children==='You win!'));
  assert.equal(nodes(tree).filter(n=>n.type==='Confetti').length,1);
  nodes(tree).find(n=>n.props?.label==='Done').props.onPress();assert.deepEqual(child.routes,['back']);child.unmount();tree=h.render();
  assert.ok(!nodes(tree).some(n=>n.props?.accessibilityLabel?.startsWith('Check ')));h.unmount();
});

test('receiver retains the acknowledged final answer until full real results are ready, with no placeholder scores',()=>{
  const time=clock(),round={...content.localGameSession(progress),ownAnswers:Array(6).fill(0),guesses:Array(5).fill(0),partnerOwnCount:6,partnerGuessCount:6};
  const h=screenHarness(progress.id,{session:round,globals:time.globals});let tree=h.render();
  nodes(tree).find(n=>n.props?.accessibilityLabel?.startsWith('A. ')).props.onPress();time.advance(160);tree=h.render();
  assert.ok(nodes(tree).some(n=>n.props?.accessibilityLabel?.startsWith('A. ')&&n.props.disabled));
  assert.ok(!nodes(tree).some(n=>n.props?.children==='You both finished!'||n.props?.children==='RESULTS'));
  assert.equal(nodes(tree).filter(n=>n.type==='Confetti').length,0);
  h.confirm({...round,guesses:Array(6).fill(0),completedAt:'2026-10-12',partnerOwnAnswers:Array(6).fill(0),partnerGuesses:Array(6).fill(0),result:{mine:6,partner:6,outcome:'tie'}});
  tree=h.render();assert.ok(nodes(tree).some(n=>n.props?.children==='It’s a draw!'));
  assert.equal(nodes(tree).filter(n=>n.type==='Confetti').length,1);assert.equal(nodes(tree).filter(n=>n.type==='ActivityIndicator').length,0);h.unmount();
});

test('six own answers lead to a dedicated inter-round page without any answer request',()=>{
  const time=clock(),h=screenHarness(progress.id,{session:content.localGameSession(progress),globals:time.globals});
  for(let i=0;i<6;i++){const tree=h.render();nodes(tree).find(n=>n.props?.accessibilityLabel?.startsWith('A. ')).props.onPress();time.advance(160);}
  let tree=h.render();assert.ok(nodes(tree).some(n=>n.props?.children==='Step 1 Complete'));
  assert.ok(nodes(tree).some(n=>n.props?.label==='Continue'));assert.equal(h.localWrites(),6);
  nodes(tree).find(n=>n.props?.label==='Continue').props.onPress();tree=h.render();
  assert.ok(nodes(tree).some(n=>n.props?.children==='Guess their answer'));h.unmount();
});

test('late saved-round response cannot reopen a game after Back',async()=>{
  const h=screenHarness(progress.id);let tree=h.render();nodes(tree).find(n=>n.type==='BackButton').props.onPress();
  assert.deepEqual(h.routes,['back']);h.unmount();
  h.session.resolve(content.localGameSession(progress));await flush();assert.deepEqual(h.routes,['back']);
});

test('game routes rely on global native edge back in every mode; double taps cannot push two games',()=>{
  const lobby=screenHarness(undefined,{overview:content.localGameOverview({availableIds:[game.id]})});let tree=lobby.render();
  const tile=nodes(tree).find(n=>n.type?.name==='GameTile');
  tile.props.onSelect(tile.props.game);tile.props.onSelect(tile.props.game);
  assert.equal(lobby.routes.length,1);
  lobby.setFocused(false);lobby.render();lobby.setFocused(true);lobby.render();
  tile.props.onSelect(tile.props.game);assert.equal(lobby.routes.length,2,'lobby becomes interactive again on return');
  assert.deepEqual(lobby.gestures,[]);lobby.unmount();
  for(const counts of [[0,0],[6,0],[6,2],[6,6]]){
    const session={...content.localGameSession(progress),ownAnswers:Array(counts[0]).fill(0),guesses:Array(counts[1]).fill(0)};
    const h=screenHarness(progress.id,{session});tree=h.render();
    assert.deepEqual(h.gestures,[],'mode does not override the global navigator');
    const back=nodes(tree).find(n=>n.type==='BackButton');back.props.onPress();back.props.onPress();
    assert.deepEqual(h.routes,['back']);h.unmount();
  }
});

test('native focus loss during selection preserves outgoing drawing and the durable answer',()=>{
  const time=clock(),h=screenHarness(progress.id,{session:content.localGameSession(progress),globals:time.globals});
  const tree=h.render();nodes(tree).find(n=>n.props?.accessibilityLabel?.startsWith('A. ')).props.onPress();
  const before=nodes(h.render()).find(n=>n.type==='Transition').props.stageKey;
  h.setFocused(false);h.render();time.advance(1000);
  assert.equal(nodes(h.render()).find(n=>n.type==='Transition').props.stageKey,before,'no second inner slide during edge pop');
  assert.equal(h.draft().session.ownAnswers.length,1);
  h.setFocused(true);h.render();assert.notEqual(nodes(h.render()).find(n=>n.type==='Transition').props.stageKey,before);
  h.unmount();
});
