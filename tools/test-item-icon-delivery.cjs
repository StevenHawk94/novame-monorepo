const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the offline base bundle is exactly the current Tap Your Day vocabulary, without unrelated icons', () => {
  const bundle = JSON.parse(read('apps/mobile/src/lib/bundled-item-ids.json'));
  const map = read('apps/mobile/src/lib/item-images.g.ts');
  const required = new Set([
    ...require('../packages/engine/src/items/tap-your-day-local.json').flatMap(group => [...group.defaults, ...group.optional]).map(choice => choice.itemId).filter(id => id.startsWith('memory.')),
  ]);
  assert.equal(required.size, 386);
  assert.equal(bundle.itemIds.length, required.size);
  assert.equal(new Set(bundle.itemIds).size, required.size);
  assert.equal(bundle.targetCount, required.size);
  assert.deepEqual([...bundle.itemIds].sort(), [...required].sort());
  assert.equal([...map.matchAll(/require\('\.\.\/\.\.\/assets\/Tap-your-day-Icons\/([^']+)\.webp'\)/g)].length, required.size);
  const bundledSet = new Set(bundle.itemIds);
  const runtimeFiles = require('./tap-day-test-data.cjs').rows.filter(row=>row.itemId.startsWith('memory.')).map(row=>row.itemId);
  assert.equal(runtimeFiles.length, required.size);
  assert.deepEqual(runtimeFiles.sort(), [...bundledSet].sort());
  for (const id of required) assert.ok(bundle.itemIds.includes(id), `missing fixed icon ${id}`);
  for (const id of bundle.itemIds) {
    assert.ok(map.includes(require('./tap-day-test-data.cjs').sourceById.get(id).asset));
    assert.ok(fs.statSync(require('./tap-day-test-data.cjs').assetFor(id)).size > 0);
  }
});

test('the immutable R2 inventory covers every base icon with verified local hashes', () => {
  const dictionary = { items: require('../packages/engine/src/items/display-catalog.json') };
  const inventory = JSON.parse(read('tools/item-source/memory-items/r2-base-icons-manifest.json'));
  assert.equal(inventory.catalogVersion, read('packages/engine/src/items/display-catalog.ts').match(/ITEM_CATALOG_VERSION = '([^']+)'/)[1]);
  assert.equal(inventory.count, 5439);
  assert.equal(inventory.entries.length, Object.keys(dictionary.items).length);
  assert.equal(new Set(inventory.entries.map((entry) => entry.itemId)).size, inventory.count);
  let bytes = 0;
  for (const entry of inventory.entries) {
    const file = fs.readFileSync(path.join(root, 'tools/item-source/memory-items/each', `${entry.itemId}.webp`));
    bytes += file.length;
    assert.equal(entry.bytes, file.length);
    assert.equal(entry.sha256, crypto.createHash('sha256').update(file).digest('hex'));
    assert.equal(entry.key, `Items/base-icons/${inventory.catalogVersion}/${entry.itemId}.webp`);
  }
  assert.equal(inventory.totalBytes, bytes);
});

test('remote base icons are demand-driven and visible tiles download immediately', () => {
  const queue = read('apps/mobile/src/lib/download-queue.ts');
  const mobilePackage = read('apps/mobile/package.json');
  const sprite = read('apps/mobile/src/components/ui/item-sprite.tsx');
  const widget = read('apps/mobile/src/lib/widget-sync.ts');
  const add = read('apps/mobile/src/components/main/custom-tap-item-sheet.tsx');
  assert.doesNotMatch(queue, /BASE_ICON_FEED_WINDOW|baseItemBulk|NetworkStateType\.WIFI|kBaseItemIconHydration/);
  assert.doesNotMatch(mobilePackage, /expo-network/);
  assert.match(sprite, /remoteImageUri\(itemId\) \|\| \(!bundledArt \? baseItemIconUrl\(itemId\) : ''\)/);
  assert.match(sprite, /ensurePriorityR2Image\(remoteUri\)/);
  assert.match(widget, /baseItemIconUrl\(itemId\)/);
  assert.match(widget, /ensurePriorityR2Image\(src\)/);
  assert.match(add, /<TapDayIcon itemId=\{item.itemId\}/);
  assert.doesNotMatch(add, /matchItems|remote-items/);
});

test('current gift prefetch remains bounded and Tap icons stay bundled after diary art retirement', () => {
  const prefetch=read('apps/mobile/src/lib/adventure-prefetch.ts');
  assert.match(prefetch,/result\.gifts\.slice\(0, 2\)/);
  assert.match(prefetch,/ensurePriorityR2Image\(gift.url, -1\)/);
  assert.match(read('apps/mobile/src/lib/base-item-icons.ts'),/return ''/);
  const remote=read('apps/mobile/src/lib/remote-items.ts');
  const body=remote.slice(remote.indexOf('export function remoteImageUri'),remote.indexOf('let displayManifest'));
  assert.doesNotMatch(body,/remoteItemAssetUrl\(/);
  assert.match(body,/return ''/);
});

test('retired catalog probe performs no network work; foreground queue remains shared', () => {
  const contentVersion = read('apps/mobile/src/lib/content-version.ts');
  const layout = read('apps/mobile/app/_layout.tsx');
  assert.doesNotMatch(contentVersion, /\bfetch\(|setTimeout\(|stageLatestManifest\(/);
  assert.match(contentVersion, /return Promise.resolve\(\)/);
  assert.match(layout, /const shouldCheckContentVersion = !isInitialPass && becameActive/);
  assert.match(layout, /\.\.\.\(shouldCheckContentVersion/);
});
