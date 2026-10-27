const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');
const plain = x => JSON.parse(JSON.stringify(x));
const legacy = require('../packages/engine/src/items/tap-your-day-v2.json');
const groups = require('../packages/engine/src/items/tap-your-day-local.json');
const engine = load('packages/engine/src/items/tap-your-day.ts', {
  './tap-your-day-v1.json': require('../packages/engine/src/items/tap-your-day-v1.json'),
  './tap-your-day-v2.json': legacy, './tap-your-day-v4.json': require('../packages/engine/src/items/tap-your-day-v4.json'), './tap-your-day-local.json': groups,
});
const dictionary = { items: { ...require('../packages/engine/src/items/display-catalog.json'), ...require('../packages/engine/src/items/tap-your-day-display.json'), ...load('packages/engine/src/items/tap-person-items.ts').TAP_PERSON_ITEMS } };
function resolver() {
  const forbidden = () => { throw Error('v4 unexpectedly touched a remote dictionary or matcher'); };
  return load('apps/api/src/lib/reflect-draft.js', {
    '@supabase/supabase-js': {}, '@novame/engine': { ...engine, ITEM_DISPLAY_CATALOG: dictionary.items, matchItems: forbidden },
    '@/lib/remote-items': { getMergedDictionary: forbidden }, '@/lib/reflect-ai': {}, '@/lib/connection-insight-v8': {},
  }).resolveDraftInput;
}
test('approved classification matches all 391 runtime IDs, labels and local images exactly', () => {
  const approved = require('../docs/tap-your-day-391-source.json');
  assert.equal(engine.TAP_YOUR_DAY_CHOICES.length, 134);
  assert.equal(engine.TAP_YOUR_DAY_OPTIONAL_CHOICES.length, 257);
  const retained = approved.map(row => ({itemId:row.itemId,label:row.label}));
  const runtime = engine.TAP_YOUR_DAY_LOCAL_CHOICES;
  assert.equal(new Set(runtime.map(x => x.itemId)).size, 391);
  assert.deepEqual(plain(runtime.map(x => [x.itemId, x.label]).sort()), retained.map(x => [x.itemId, x.label]).sort());
  const art = fs.readFileSync('apps/mobile/src/lib/tap-day-images.g.ts', 'utf8');
  const entries = [...art.matchAll(/'([^']+)': require\('([^']+)'\)/g)];
  assert.equal(entries.length, 391);
  for (const [, id, file] of entries) {
    assert.ok(engine.tapYourDayChoice(id));
    const bytes = fs.readFileSync(path.resolve('apps/mobile/src/lib', file));
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
  }
});
test('all v4 selections resolve offline with canonical names; client text cannot spoof facts', async () => {
  const resolve = resolver(), all = engine.TAP_YOUR_DAY_LOCAL_CHOICES;
  const result = [];
  for (let i = 0; i < all.length; i += 30) {
    const batch = all.slice(i, i + 30);
    const value = await resolve(null, { mode: 'prompt', selectionVersion: engine.TAP_YOUR_DAY_VERSION,
      selectedItems: batch.map(x => ({ itemId: x.itemId, label: 'spoofed', kind: 'wrong', custom: false })), body: 'private optional note' });
    assert.equal(value.error, undefined); result.push(...value.matches);
    assert.deepEqual(plain(value.matches.map(x => x.label)), plain(batch.map(x => x.label)));
  }
  assert.equal(result.length, 391); assert.ok(result.every(x => x.sourceExcerpt === ''));
  assert.equal(result.filter(x => x.custom).length, 257);
});
test('v4 rejects excluded/unknown/malformed IDs and over-limit payloads without network access', async () => {
  const resolve = resolver(), input = { mode: 'prompt', selectionVersion: engine.TAP_YOUR_DAY_VERSION };
  for (const selectedItems of [[{ itemId: 'memory.2569_laptop' }], [null], [{ itemId: 'unknown' }]]) {
    assert.equal((await resolve(null, { ...input, selectedItems })).error, 'invalid_selection_item');
  }
  assert.equal((await resolve(null, { ...input, selectedItems: [] })).error, 'empty');
  const choice = engine.TAP_YOUR_DAY_LOCAL_CHOICES[0];
  assert.equal((await resolve(null, { ...input, selectedItems: Array(31).fill(choice) })).error, 'too_many_items');
  assert.equal((await resolve(null, { ...input, selectedItems: [choice, choice] })).matches.length, 1);
  assert.equal(engine.tapYourDaySelectionLimit({ toString: null }), 0);
});
test('v2/v3 retain all 131 original default meanings, including retired-default cuisines', () => {
  for (const version of ['tap-your-day-v2', 'tap-your-day-v3']) {
    const old = legacy.flatMap(q => q.groups.flatMap(g => g.choices)); assert.equal(old.length, 131);
    for (const choice of old) assert.equal(engine.tapYourDayChoice(choice.itemId, version).label, choice.label);
    assert.equal(engine.tapYourDayChoice('memory.5399_washing_machine', version), undefined);
  }
  assert.equal(engine.TAP_YOUR_DAY_QUESTIONS[1].groups.find(g => g.title === 'CUISINE').choices.length, 0);
});
test('selection components and preferences never import the matcher or remote catalogue', () => {
  for (const file of ['apps/mobile/src/components/main/custom-tap-item-sheet.tsx', 'apps/mobile/src/components/ui/tap-day-icon.tsx',
    'apps/mobile/src/lib/custom-tap-catalog.ts', 'apps/mobile/src/lib/custom-tap-items.ts', 'apps/mobile/app/(main)/reflect-guided.tsx']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /matchItems|remote-items|itemRuleContext|remoteImageUri|dictionaryForRevision/);
  }
  assert.match(fs.readFileSync('apps/mobile/src/lib/download-queue.ts', 'utf8'), /if \(localTapIds.has\(item.itemId\)\) continue/);
  assert.match(fs.readFileSync('apps/mobile/src/lib/item-icon-prewarm.ts', 'utf8'), /if \(TAP_DAY_IMAGES\[itemId\]\) return ''/);
});
test('optional choices survive restart, safely import legacy approved IDs, and never leak across accounts', async () => {
  const store = new Map(), pending = deferred(); let listener;
  const optional = engine.TAP_YOUR_DAY_OPTIONAL_CHOICES[0];
  store.set('legacy:alice', JSON.stringify([{ ...optional, label: 'Old custom name' }, { itemId: 'retired', custom: true }]));
  const make = () => {
    const h = hooks();
    const module = load('apps/mobile/src/lib/custom-tap-items.ts', {
      react: h.react, '@novame/engine': engine,
      './storage': { storage: { getString: key => store.get(key), set: (key, value) => store.set(key, value) } },
      './supabase': { supabase: { auth: { getSession: () => pending.promise,
        onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; } } } },
      '../shared/storage/keys': { kCustomTapItems: { keyFor: id => 'legacy:' + id }, kLocalTapItems: { keyFor: id => 'local:' + id } },
    });
    return { render: () => h.render(module.useCustomTapItems), unmount: h.unmount };
  };
  const c = make(); c.render(); listener('SIGNED_IN', { user: { id: 'alice' } });
  const alice = c.render(); assert.deepEqual(plain(alice.items), [plain(optional)]);
  for (const item of engine.TAP_YOUR_DAY_OPTIONAL_CHOICES) alice.save(item);
  assert.equal(c.render().items.length, 257);
  assert.equal(JSON.parse(store.get('legacy:alice'))[0].label, 'Old custom name');
  listener('SIGNED_IN', { user: { id: 'bob' } });
  assert.throws(() => alice.save(optional), /account is still loading/);
  assert.equal(c.render().items.length, 0);
  pending.resolve({ data: { session: { user: { id: 'alice' } } } }); await flush();
  assert.equal(c.render().items.length, 0, 'late initial session cannot overwrite a newer account');
  c.unmount(); const restart = make(); restart.render(); listener('SIGNED_IN', { user: { id: 'alice' } });
  assert.equal(restart.render().items.length, 257); restart.unmount();
});
