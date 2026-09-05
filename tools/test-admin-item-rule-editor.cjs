/* Offline regressions for the direct Admin item-rule editor. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file, imports = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, allowJs: true },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports, console,
    require: (name) => {
      if (name in imports) return imports[name];
      if (name.startsWith('.')) {
        const local = path.join(path.dirname(file), name);
        if (local.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(root, local), 'utf8'));
        if (fs.existsSync(path.join(root, `${local}.ts`))) return load(`${local}.ts`, imports);
        if (fs.existsSync(path.join(root, `${local}.json`))) return JSON.parse(fs.readFileSync(path.join(root, `${local}.json`), 'utf8'));
      }
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return mod.exports;
}

const engine = {
  ...load('packages/engine/src/items/item-matcher.ts'),
  ...load('packages/engine/src/items/dictionary.ts'),
  ...load('packages/engine/src/items/item-rules.ts'),
  ...load('packages/engine/src/items/remote-manifest.ts'),
};
const manifestStub = { loadCurrentItemManifest: async () => ({ version: '0', manifest: null }) };
const review = load('apps/admin/src/lib/item-review.js', {
  '@novame/engine': engine,
  './item-manifest': manifestStub,
});
const catalog = load('apps/admin/src/lib/item-catalog.js', {
  '@novame/engine': engine,
  '@/generated/item-atlas.json': JSON.parse(fs.readFileSync(path.join(root, 'apps/admin/src/generated/item-atlas.json'), 'utf8')),
});

test('manual additions are normalized, revision-safe AUTO phrases', async () => {
  const itemId = Object.keys(engine.ITEM_DICTIONARY.items)
    .find((id) => engine.ITEM_DICTIONARY.items[id].displayName === 'Running');
  const writes = [];
  const db = { rpc: async (name, args) => {
    if (name === 'item_rule_snapshot') return { data: { catalog:engine.ITEM_CATALOG_VERSION, revision:7, rules:[] } };
    writes.push(args); return { data:8, error:null };
  } };
  await review.publishManualRule(db, {
    action:'add', itemId, keyword:'Freshly-Painted Track Today!', revision:7,
  }, 'admin');
  assert.equal(writes[0].p_keyword, 'freshly painted track today');
  assert.equal(writes[0].p_action, 'enable');
  assert.equal(writes[0].p_candidate, null);
  await assert.rejects(review.publishManualRule(db, {
    action:'add', itemId, keyword:'running', revision:7,
  }, 'admin'), /multi-word/);
  await assert.rejects(review.publishManualRule(db, {
    action:'add', itemId, keyword:'another safe phrase', revision:6,
  }, 'admin'), /Rules changed/);
});

test('catalog exposes effective modes, dynamic source, thumbnails, and disabled overrides', () => {
  const coffeeId = Object.keys(engine.ITEM_DICTIONARY.items)
    .find((id) => engine.ITEM_DICTIONARY.items[id].displayName === 'Coffee');
  const result = catalog.buildAdminItemCatalog({
    remoteManifest:null,
    snapshot:{ revision:2, rules:[
      { keyword:'a freshly brewed cup', item_id:coffeeId, action:'enable', revision:1 },
      { keyword:'morning coffee', item_id:coffeeId, action:'disable', revision:2 },
    ] },
  });
  const detail = catalog.findAdminItem(result, coffeeId);
  assert.equal(detail.revision, 2);
  assert.equal(detail.item.thumbnail.kind, 'atlas');
  assert.ok(detail.item.rules.some((rule) => rule.keyword === 'a freshly brewed cup'
    && rule.triggerMode === 'AUTO' && rule.source === 'ADMIN'));
  assert.ok(detail.item.disabledRules.some((rule) => rule.keyword === 'morning coffee'));
  const search = catalog.queryAdminItemCatalog(result, { q:'freshly brewed cup', limit:10 });
  assert.ok(search.items.some((item) => item.itemId === coffeeId));
});
