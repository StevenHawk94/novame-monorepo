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
    module: mod, exports: mod.exports, console, TextEncoder,
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
const batches = load('apps/admin/src/lib/item-keyword-batch.js', {
  '@novame/engine': engine,
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
  }, 'admin'), /multi-word|NEVER_AUTO/);
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

test('suggestions expose an icon backlog and require verified source evidence', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/app/admin/_components/ItemsTab.tsx'), 'utf8');
  assert.match(source, /Icon Backlog \(\{data\?\.iconBacklog\?\.length \|\| 0\}\)/);
  assert.ok(source.includes('Added to Icon Backlog. It will stay visible below'));
  assert.ok(source.includes('row.evidence_version === 2'));
  assert.ok(source.includes("Boolean((row.source_phrase || '').trim())"));
  assert.ok(source.includes('Needs verified keyword'));
  assert.ok(source.includes("'error' in error.body"), 'server validation detail must replace a generic HTTP 409');
});

test('AUTO keyword CSV template round-trips quoted cells and validates the whole batch', () => {
  const fakeCatalog = { items:[
    { itemId:'coffee', displayName:'Coffee, Hot', category:'Food', rules:[
      { keyword:'coffee', triggerMode:'AUTO', active:true },
      { keyword:'java', triggerMode:'NEVER_AUTO', active:false },
    ], disabledRules:[{ keyword:'morning cup' }] },
    { itemId:'tennis', displayName:'Tennis', category:'Activity', rules:[], disabledRules:[] },
  ] };
  const template = batches.buildAutoKeywordTemplateCsv(fakeCatalog);
  assert.ok(template.startsWith('\uFEFFitem_id,icon_name,category,existing_auto_keywords,auto_keywords_to_add'));
  assert.ok(template.includes('coffee,"Coffee, Hot",Food,coffee,'));
  const csv = template.replace(
    'coffee,"Coffee, Hot",Food,coffee,\r\n',
    'coffee,"Coffee, Hot",Food,coffee,freshly brewed | coffee\r\n',
  );
  const result = batches.compileAutoKeywordBatchCsv(csv, fakeCatalog);
  assert.deepEqual(JSON.parse(JSON.stringify(result.additions)), [
    { rowNumber:2, itemId:'coffee', iconName:'Coffee, Hot', keyword:'freshly brewed' },
  ]);
  assert.equal(result.skipped[0].reason, 'already active');
  assert.deepEqual(JSON.parse(JSON.stringify(result.errors)), []);
});

test('AUTO keyword CSV rejects cross-icon conflicts, NEVER_AUTO, disabled, and stale icon names', () => {
  const fakeCatalog = { items:[
    { itemId:'coffee', displayName:'Coffee', category:'Food', rules:[
      { keyword:'coffee', triggerMode:'AUTO', active:true },
      { keyword:'java', triggerMode:'NEVER_AUTO', active:false },
    ], disabledRules:[{ keyword:'morning cup' }] },
    { itemId:'tennis', displayName:'Tennis', category:'Activity', rules:[], disabledRules:[] },
  ] };
  const header = batches.AUTO_KEYWORD_TEMPLATE_HEADERS.join(',');
  const conflict = batches.compileAutoKeywordBatchCsv(`${header}\ncoffee,Coffee,Food,coffee,java | morning cup\ntennis,Tennis,Activity,,coffee`, fakeCatalog);
  assert.equal(conflict.additions.length, 0);
  assert.ok(conflict.errors.some((message) => message.includes('NEVER_AUTO')));
  assert.ok(conflict.errors.some((message) => message.includes('disabled')));
  assert.ok(conflict.errors.some((message) => message.includes('already belongs')));
  const stale = batches.compileAutoKeywordBatchCsv(`${header}\ncoffee,Tea,Food,,fresh brew`, fakeCatalog);
  assert.match(stale.errors[0], /download a fresh template/);
});

test('the complete bundled icon catalog fits in one downloadable CSV template', () => {
  const fullCatalog = catalog.buildAdminItemCatalog({ remoteManifest:null, snapshot:{ revision:0, rules:[] } });
  const template = batches.buildAutoKeywordTemplateCsv(fullCatalog);
  assert.ok(fullCatalog.items.length > 5_000);
  assert.equal(batches.parseCsv(template).length, fullCatalog.items.length + 1);
  assert.ok(Buffer.byteLength(template, 'utf8') < 4 * 1024 * 1024);
});

test('rule editor exposes template download, preview, and atomic publish controls', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/app/admin/_components/ItemRuleEditor.tsx'), 'utf8');
  assert.ok(source.includes('Download CSV template'));
  assert.ok(source.includes("action:'preview'"));
  assert.ok(source.includes("action:'apply'"));
  assert.ok(source.includes('Publish batch'));
});
