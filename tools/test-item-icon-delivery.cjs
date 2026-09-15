const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the offline bundle is exactly 256 valid icons and contains every fixed product icon', () => {
  const bundle = JSON.parse(read('apps/mobile/src/lib/bundled-item-ids.json'));
  const map = read('apps/mobile/src/lib/item-images.g.ts');
  const required = new Set([
    ...[...read('packages/engine/src/items/tap-your-day.ts').matchAll(/\['[^']+',\s*'(memory\.[^']+)'\]/g)].map((m) => m[1]),
    ...[...read('apps/mobile/app/(onboarding)/index.tsx').matchAll(/itemId:\s*'(memory\.[^']+)'/g)].map((m) => m[1]),
    'memory.1486_park',
  ]);
  assert.equal(bundle.itemIds.length, 256);
  assert.equal(new Set(bundle.itemIds).size, 256);
  assert.equal([...map.matchAll(/require\('\.\.\/\.\.\/assets\/items\/each\/([^']+)\.webp'\)/g)].length, 256);
  const bundledSet = new Set(bundle.itemIds);
  const runtimeFiles = fs.readdirSync(path.join(root, 'apps/mobile/assets/items/each'))
    .filter((filename) => filename.endsWith('.webp'))
    .map((filename) => filename.slice(0, -5));
  assert.equal(runtimeFiles.length, 256);
  assert.deepEqual(runtimeFiles.sort(), [...bundledSet].sort());
  for (const id of required) assert.ok(bundle.itemIds.includes(id), `missing fixed icon ${id}`);
  for (const id of bundle.itemIds) {
    assert.match(map, new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.webp`));
    assert.ok(fs.statSync(path.join(root, 'apps/mobile/assets/items/each', `${id}.webp`)).size > 0);
  }
});

test('the immutable R2 inventory covers every base icon with verified local hashes', () => {
  const dictionary = require('../packages/engine/src/items/dictionary.json');
  const inventory = JSON.parse(read('tools/item-source/memory-items/r2-base-icons-manifest.json'));
  assert.equal(inventory.catalogVersion, require('../packages/engine/src/items/rule-metadata.json').version);
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
  assert.match(add, /<ItemSprite itemId=\{id\}/);
});

test('entry icons are bounded, prewarmed under the cover, and never render blank', () => {
  const queue = read('apps/mobile/src/lib/download-queue.ts');
  const prewarm = read('apps/mobile/src/lib/item-icon-prewarm.ts');
  const prefetch = read('apps/mobile/src/lib/prefetch.ts');
  const home = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  const friends = read('apps/mobile/app/(main)/(tabs)/friends.tsx');
  const sprite = read('apps/mobile/src/components/ui/item-sprite.tsx');

  assert.match(queue, /allowBeforeAndroidUi\?: boolean/);
  assert.match(queue, /requiresAndroidUi: IS_ANDROID && !allowBeforeAndroidUi/);
  assert.match(prewarm, /A deadline releases the caller only/);
  assert.match(prefetch, /const MEMORIES_FIRST_VIEW_ICON_LIMIT = 18/);
  assert.match(prefetch, /const PAIRED_FIRST_VIEW_CARD_LIMIT = 2/);
  assert.match(prefetch, /const PAIRED_FIRST_VIEW_ICON_LIMIT = 18/);
  assert.match(home, /const HOME_BUBBLE_ICON_WAIT_MS = 1_200/);
  assert.match(home, /await homeIconsReady/);
  assert.ok(home.indexOf('await homeIconsReady') < home.indexOf("markHomeEntryAsset('home-data'"));
  assert.match(friends, /prewarmPairedFeedItemIcons\(nextFeed/);
  assert.match(sprite, /item\?\.emoji \?\? '✨'/);
});

test('content version has one cold-start request and one bounded failure retry', () => {
  const contentVersion = read('apps/mobile/src/lib/content-version.ts');
  const layout = read('apps/mobile/app/_layout.tsx');
  assert.match(contentVersion, /const FAILURE_RETRY_DELAY_MS = 5_000/);
  assert.match(contentVersion, /if \(allowAutomaticRetry && !retryTimer\)/);
  assert.match(contentVersion, /runContentVersionCheck\(false\)/);
  assert.match(contentVersion, /if \(refreshIncomplete\)/);
  assert.match(layout, /const shouldCheckContentVersion = !isInitialPass && becameActive/);
  assert.match(layout, /\.\.\.\(shouldCheckContentVersion/);
});
