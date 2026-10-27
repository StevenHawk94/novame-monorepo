const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { load } = require('./lifecycle-test-utils.cjs');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'apps/mobile/assets/Tap-your-day-Icons');
const groups = require('../packages/engine/src/items/tap-your-day-local.json');
const choices = groups.flatMap(group => [...group.defaults, ...group.optional]);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const entries = [...read('apps/mobile/src/lib/tap-day-images.g.ts').matchAll(/'([^']+)': require\('\.\.\/\.\.\/assets\/Tap-your-day-Icons\/([^']+)'\)/g)];
function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name), prefix + entry.name + '/')
    : entry.name.endsWith('.webp') ? [prefix + entry.name] : []);
}
test('Tap-your-day-Icons contains exactly the 391 selectable icons, with no unused or duplicate presentation files', () => {
  assert.equal(entries.length, 391);
  assert.equal(groups.reduce((n, group) => n + group.defaults.length, 0), 134);
  assert.equal(groups.reduce((n, group) => n + group.optional.length, 0), 257);
  assert.deepEqual(entries.map(row => row[1]).sort(), choices.map(choice => choice.itemId).sort());
  assert.deepEqual(walk(runtime).sort(), entries.map(row => row[2]).sort());
  assert.equal(new Set(entries.map(row => row[2])).size, 391);
  for (const [, id, asset] of entries) {
    const file = path.join(runtime, asset), bytes = fs.readFileSync(file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(sha(file), require('./tap-day-test-data.cjs').sourceById.get(id).sha256);
  }
});
test('eleven canonical art promotions are recoverable outside runtime and rebuild paths still exist', () => {
  const builder = read('tools/build-items-v19.py');
  const promotions = [...builder.matchAll(/SOURCE_DIR \/ "canonical-promotions\/([^"/]+\.webp)"/g)];
  assert.equal(promotions.length, 11);
  assert.doesNotMatch(builder, /assets\/items\/tap-person\//);
  for (const [, filename] of promotions) {
    assert.ok(fs.statSync(path.join(root, 'tools/item-source/memory-items/canonical-promotions', filename)).size > 0);
  }
  assert.doesNotMatch(builder, /len\(bundled_ids\) != 256/);
  assert.match(builder, /bundled_ids != approved_ids/);
});
test('the generated list includes every display name, stable ID and local file, including optional choices', () => {
  const report = read('docs/tap-your-day-icons.txt');
  const rows = report.split('\n').filter(line => line.startsWith('  ')).map(line => line.trim().split('\t'));
  assert.equal(rows.length, 391);
  const listed = new Map(rows.map(([name, id, asset]) => [id, { name, asset }]));
  const paths = new Map(entries.map(row => [row[1], row[2]]));
  for (const choice of choices) assert.deepEqual(listed.get(choice.itemId), { name: choice.label, asset: paths.get(choice.itemId) });
  assert.match(report, /默认 134 个；可选添加 257 个/);
});
test('both generator entry points validate deterministically without restoring old extras or rewriting R2 inventory', () => {
  const files = ['apps/mobile/src/lib/item-images.g.ts', 'apps/mobile/src/lib/tap-day-images.g.ts',
    'apps/mobile/src/lib/tap-person-images.ts', 'apps/mobile/src/lib/bundled-item-ids.json',
    'docs/tap-your-day-icons.txt', 'docs/tap-your-day-391-source.json', 'tools/item-source/memory-items/r2-base-icons-manifest.json'];
  const before = files.map(file => [sha(path.join(root, file)), fs.statSync(path.join(root, file)).mtimeMs]);
  for (const script of ['build-item-icon-assets.mjs', 'build-local-tap-icons.cjs']) {
    const output = execFileSync(process.execPath, [path.join(root, 'tools', script), '--check', '--select'], { cwd: root, encoding: 'utf8' });
    assert.match(output, /Verified 391 local Tap Your Day icons/);
  }
  assert.deepEqual(files.map(file => [sha(path.join(root, file)), fs.statSync(path.join(root, file)).mtimeMs]), before);
});
test('a removed offline-only icon retains its historical identity and resolves artwork through the existing R2 queue', () => {
  const display = require('../packages/engine/src/items/display-catalog.json');
  const inventory = require('./item-source/memory-items/r2-base-icons-manifest.json');
  const id = 'memory.2569_laptop';
  assert.ok(display[id]?.displayName);assert.equal(fs.existsSync(path.join(runtime, 'each', id + '.webp')), false);
  const entry = inventory.entries.find(row => row.itemId === id);assert.ok(entry);
  const base = load('apps/mobile/src/lib/base-item-icons.ts', { '@novame/engine': { ITEM_DISPLAY_CATALOG: display, ITEM_CATALOG_VERSION: inventory.catalogVersion } });
  const requests = [], jsx = (type, props) => ({ type, props });
  const { ItemSprite } = load('apps/mobile/src/components/ui/item-sprite.tsx', {
    react: { memo: fn => fn, useSyncExternalStore() {}, useState: value => [typeof value === 'function' ? value() : value, () => {}], useEffect: fn => fn() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'ios' }, View: 'View', Text: 'Text', StyleSheet: { create: value => value } },
    'expo-image': { Image: 'Image' }, '../../lib/item-images.g': { ITEM_IMAGES: {} },
    '../../lib/tap-person-images': { TAP_PERSON_IMAGES: {} }, '../../lib/tap-day-images.g': { TAP_DAY_IMAGES: {} },
    '../../lib/base-item-icons': base,
    '../../lib/remote-items': { remoteImageUri: () => '', mergedItemDictionary: () => ({ items: display }) },
    '../../lib/download-queue': { ensurePriorityR2Image: async url => { requests.push(url); return null; } },
    '../../lib/item-manifest-cache': { subscribeRemoteItemManifest() {}, getCachedRemoteItemManifest: () => null },
    '../../lib/android-r2-file-cache': { getAndroidR2CachedUri: () => null, invalidateAndroidR2CachedFile() {} },
  });
  const tile = ItemSprite({ itemId: id, size: 58 });
  assert.equal(tile.props.children.props.children, display[id].emoji ?? '✨');
  assert.deepEqual(requests, ['https://media.novameapp.com/' + entry.key]);
});
