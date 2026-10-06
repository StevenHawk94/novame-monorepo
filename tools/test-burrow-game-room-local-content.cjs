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

test('complete bundled catalogue has local artwork and 420 valid questions', () => {
  assert.equal(content.GAME_ROOM_GAMES.length, 70);
  assert.equal(content.GAME_ROOM_CATEGORIES.length, 7);
  assert.equal(catalog.games.reduce((sum, item) => sum + item.questions.length, 0), 420);
  for (const item of catalog.games) {
    assert.ok(content.GAME_ROOM_CATEGORIES.includes(item.category));
    assert.ok(item.title && item.hook);
    assert.equal(item.questions.length, 6);
    assert.ok(fs.existsSync(path.resolve(__dirname, '../apps/mobile/assets/burrow/game-room-v1', `${item.id}.webp`)));
    for (const question of item.questions) {
      assert.ok(question.self && question.partner);
      assert.equal(question.options.length, 4);
    }
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
    '@/lib/app-major-update': { authenticatedUserId: async () => 'user', majorUpdateEnabled: async () => true,
      appMajorUpdateServiceClient: () => ({ rpc: async () => ({ data: state, error: null }) }), commandStatus: () => 400 },
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
  let stateRequests = 0, cachedOverview = options.overview ?? null;
  const jsx = (type, props) => ({ type, props });
  const screen = load('apps/mobile/src/components/burrow/game-room-screen.tsx', {
    '@react-navigation/native': { useIsFocused: () => true },
    react: react.react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'Image', 'ImageBackground', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name])),
      StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 375 }), Alert: { alert() {} }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-router': { router: { push() {}, back() {} } }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 0 }) },
    '@/lib/burrow-game-room-api': { gameOverview: () => { stateRequests++; return overview.promise; }, gameSession: () => session.promise, ...options.api },
    '@/lib/burrow-game-room-art': { gameRoomBackground: 1, gameRoomHero: 2, gameRoomIcons: {} },
    '@/lib/burrow-store': { useBurrow: () => ({ data: null }), refreshBurrow: async () => {} },
    '@/lib/notification-settings': {}, '@/lib/burrow-ui-assets': { BURROW_GAME_RULE_ICONS: [1, 2, 3] }, './burrow-back-button': { BurrowBackButton: 'BackButton' },
    '@/lib/session-lifecycle': { sessionEpoch: () => 1, subscribeSessionIdentity: () => () => {} },
    '@/lib/burrow-game-room-cache': { getCachedGameOverview: () => cachedOverview, getCachedGameSession: () => options.session ?? null,
      gameOverviewNeedsRefresh: () => !options.overview, gameSessionNeedsRefresh: () => !options.session,
      cacheGameOverview: value => { cachedOverview = value; }, cacheGameSession() {} },
    '@/lib/burrow-game-room-content': content,
  }, { setInterval: () => 1, clearInterval() {}, ...options.globals });
  const render = () => react.render(() => screen.GameRoomScreen({ initialSessionId }));
  return { render, overview, session, unmount: react.unmount, stateRequests: () => stateRequests };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}

test('fresh install renders every game before the first state request resolves', async () => {
  const h = screenHarness();
  let tree = h.render();
  assert.equal(h.stateRequests(), 1);
  assert.equal(nodes(tree).filter(n => n.type === 'ActivityIndicator').length, 0);
  const tiles = nodes(tree).filter(n => n.type?.name === 'GameTile');
  assert.equal(tiles.length, 74); // 70 games + four Latest previews.
  tiles[0].props.onPress();
  tree = h.render();
  assert.ok(nodes(tree).some(n => n.props?.children === tiles[0].props.game.hook));
  assert.ok(nodes(tree).some(n => n.props?.label === 'Play together →'));
  h.overview.reject(new Error('offline'));
  await flush();
  tree = h.render();
  assert.equal(nodes(tree).filter(n => n.type === 'ActivityIndicator').length, 0);
  assert.ok(!nodes(tree).some(n => n.props?.children === 'offline'));
  h.unmount();
});

test('saved round renders its local question without waiting for overview revalidation', async () => {
  const h = screenHarness(progress.id);
  assert.equal(nodes(h.render()).filter(n => n.type === 'ActivityIndicator').length, 1);
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
  time.advance(180); await flush(); assert.equal(writes, 1);
  tree = h.render(); nodes(tree).find(node => node.type === 'BackButton').props.onPress();
  saved.resolve({ session: { ...round, ownAnswers: [0] } }); await flush();
  tree = h.render(); assert.ok(!nodes(tree).some(node => node.props?.children === 'Your answers'));
  assert.equal(nodes(tree).filter(node => node.type?.name === 'GameTile').length, 74);
  h.unmount();
});

test('a start receipt opens the local question immediately without a second session request', async () => {
  let reads = 0;
  const h = screenHarness(undefined, { overview: content.localGameOverview({ paired: true, availableIds: [game.id], sessions: [] }),
    api: { startGame: async () => ({ sessionId: progress.id, session: content.localGameSession(progress) }),
      gameSession: async () => { reads++; throw Error('extra read'); } } });
  let tree = h.render(); nodes(tree).find(node => node.type?.name === 'GameTile' && node.props.game.id === game.id).props.onPress();
  tree = h.render(); nodes(tree).find(node => node.props?.label === 'Start game →').props.onPress();
  await flush(); tree = h.render();
  assert.equal(reads, 0); assert.ok(nodes(tree).some(node => node.props?.children === game.questions[0].self));
  h.unmount();
});
