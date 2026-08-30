/* Offline regression tests for partner Reflect feed privacy.
 * Run: node --test tools/test-friend-feed-privacy.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function load(file, imports) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      allowJs: true,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    Date,
    URL,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: file });
  return module.exports;
}

function queryResult(data) {
  const query = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    gte() { return this; },
    lte() { return this; },
    order() { return this; },
    limit() { return this; },
    range() { return this; },
    maybeSingle() { return Promise.resolve({ data }); },
    then(resolve, reject) { return Promise.resolve({ data }).then(resolve, reject); },
  };
  return query;
}

function routeFor({ mode = 'custom', matched = [], memories = [] } = {}) {
  const reflect = {
    id: 'reflect-1',
    local_date: '2026-08-29',
    created_at: '2026-08-29T12:00:00.000Z',
    shared_to_friends: true,
  };
  const db = {
    from(table) {
      if (table === 'pairings') return queryResult({ partner_user_id: 'partner' });
      if (table === 'profiles') return queryResult({
        display_name: 'Partner',
        memory_details_mode: mode,
        share_memory_details: mode !== 'none',
      });
      if (table === 'friend_feed_reads') return queryResult({ last_read_at: '1970-01-01T00:00:00.000Z' });
      if (table === 'reflects') return queryResult([reflect]);
      if (table === 'reflect_items') return queryResult(matched);
      if (table === 'item_memories') return queryResult(memories);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return load('apps/api/src/app/api/friends/feed/route.js', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/auth-guard': { verifyToken: async () => ({ id: 'viewer' }) },
    '@/lib/reflect-draft': { serviceClient: () => db },
  });
}

function request() {
  return {
    url: 'https://example.test/api/friends/feed?userId=viewer',
    headers: new Headers(),
  };
}

test('a reflect with every item hidden is omitted from the partner feed', async () => {
  const route = routeFor({ matched: [] });
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.feed)), []);
});

test('a shared item without memory copy is not misclassified as private', async () => {
  const route = routeFor({
    matched: [{ reflect_id: 'reflect-1', item_id: 'memory.0002_coffee', position: 0, created_at: '2026-08-29T12:00:00.000Z' }],
  });
  const response = await route.GET(request());
  assert.equal(response.body.feed.length, 1);
  assert.equal(response.body.feed[0].sharesDetails, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.feed[0].details)), []);
});

test('only Hide All Details produces the explicit private feed state', async () => {
  const route = routeFor({
    mode: 'none',
    matched: [{ reflect_id: 'reflect-1', item_id: 'memory.0002_coffee', position: 0, created_at: '2026-08-29T12:00:00.000Z' }],
    memories: [{ reflect_id: 'reflect-1', item_id: 'memory.0002_coffee', description: 'Coffee this morning.' }],
  });
  const response = await route.GET(request());
  assert.equal(response.body.feed.length, 1);
  assert.equal(response.body.feed[0].sharesDetails, false);
  assert.equal(response.body.feed[0].details, null);
});

test('mobile surfaces distinguish private/empty friend details and label empty own reflections', () => {
  const friends = fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/(tabs)/friends.tsx'), 'utf8');
  const detail = fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/friend-reflect-detail.tsx'), 'utf8');
  const logs = fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/my-logs.tsx'), 'utf8');
  const reflectDetail = fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/reflect-detail.tsx'), 'utf8');
  assert.match(friends, /if \(!e\.sharesDetails\)/);
  assert.match(detail, /No memories created today\./);
  assert.doesNotMatch(logs, /You did not type anything on this reflection/);
  assert.doesNotMatch(reflectDetail, /You did not type anything on this reflection/);
  assert.match(reflectDetail, /You did not write anything for this reflection\./);
  assert.match(reflectDetail, /entry\?\.mode === 'typing' \? 'Items Matched' : 'Items Selected'/);
  assert.doesNotMatch(reflectDetail, /memTitleIcon/);
});

test('friend feed is cursor-paged six at a time without a history or item cap', () => {
  const route = fs.readFileSync(path.join(root, 'apps/api/src/app/api/friends/feed/route.js'), 'utf8');
  const mobile = fs.readFileSync(path.join(root, 'apps/mobile/src/lib/friends-api.ts'), 'utf8');
  assert.match(route, /const PAGE_SIZE = 6/);
  assert.match(route, /nextBeforeCreatedAt/);
  assert.doesNotMatch(route, /FEED_DAYS|MAX_ROWS|\.limit\(180\)|\.limit\(MAX_ROWS\)/);
  assert.match(mobile, /fetchMoreFriendFeed/);
});

test('Tap Your Day is capped at 30 without silently slicing other Reflect selections', () => {
  const engine = fs.readFileSync(path.join(root, 'packages/engine/src/items/tap-your-day.ts'), 'utf8');
  const resolver = fs.readFileSync(path.join(root, 'apps/api/src/lib/reflect-draft.js'), 'utf8');
  assert.match(engine, /MAX_TAP_YOUR_DAY_SELECTIONS = 30/);
  assert.match(resolver, /input\.selectedItems\.length > selectionLimit/);
  assert.match(resolver, /for \(const selected of input\.selectedItems\)/);
  assert.doesNotMatch(resolver, /selectedItems\.slice/);
  assert.doesNotMatch(resolver, /MAX_ITEMS_PER_REFLECT_CATEGORY/);
});

test('Connection History is chunked and cached pages merge by immutable card id', () => {
  const route = fs.readFileSync(path.join(root, 'apps/api/src/app/api/friends/insights/history/route.js'), 'utf8');
  const mobile = fs.readFileSync(path.join(root, 'apps/mobile/src/lib/friends-api.ts'), 'utf8');
  const screen = fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/their-patterns.tsx'), 'utf8');
  assert.match(route, /const PAGE_SIZE = 24/);
  assert.match(route, /nextBeforeCreatedAt/);
  assert.doesNotMatch(route, /from < 10000/);
  assert.match(mobile, /mergeConnectionHistoryCards/);
  assert.match(mobile, /fetchMoreConnectionHistory/);
  assert.match(screen, /onScroll/);
});
