const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('tab pre-rendering remains enabled while focus reconciliation yields to navigation', () => {
  const tabBar = read('apps/mobile/src/components/main/bottom-tab-bar.tsx');
  assert.match(tabBar, /navigation\.preload\(routeName\)/);
  assert.match(tabBar, /yieldDownloadQueueForInteraction\(\)/);

  for (const file of [
    'apps/mobile/app/(main)/(tabs)/bags.tsx',
    'apps/mobile/app/(main)/(tabs)/quests.tsx',
    'apps/mobile/app/(main)/(tabs)/friends.tsx',
  ]) {
    assert.match(read(file), /BurrowScreen/, `${file} uses the shared retained-page controller`);
    assert.doesNotMatch(read(file), /useFocusEffect|fetch\(/, `${file} must not start independent focus reads`);
  }
  const retiredInsights = read('apps/mobile/app/(main)/(tabs)/status.tsx');
  assert.match(retiredInsights, /<Redirect href="\/\(main\)\/\(tabs\)"/);
  assert.doesNotMatch(retiredInsights, /fetchInsights|useFocusEffect|afterUiSettles/,
    'retired Insights must not fetch data on focus');
});

test('current primary navigation uses Burrow tabs without mounting retired Court/Insights screens', () => {
  const home = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  const tabs = read('apps/mobile/src/components/main/bottom-tab-bar.tsx');
  const layout = read('apps/mobile/app/(main)/(tabs)/_layout.tsx');
  assert.match(home, /BurrowScreen section="home" asTab/);
  assert.match(tabs, /label: 'Home'[\s\S]*label: 'Burrow'[\s\S]*label: 'Quests'[\s\S]*label: 'Shop'[\s\S]*label: 'Moments'/);
  assert.doesNotMatch(tabs, /label: 'Paired'|label: 'Connection'|label: 'Memories'/);
  assert.doesNotMatch(layout, /component=\{Court/);
});

test('Home ignores unrelated R2 completions and Thump does not force its render', () => {
  const home = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  assert.match(home, /BurrowScreen/);
  assert.doesNotMatch(home, /setCosmeticTick/);
  assert.doesNotMatch(home, /subscribeR2AssetChanges|useR2AssetRevision/);

  const queue = read('apps/mobile/src/lib/download-queue.ts');
  assert.match(queue, /subscribeR2AssetKeyChanges/);
  assert.match(queue, /notifyAssetReady\(task\.key\)/);
});

test('foreground recovery is staged and Connection caches refresh globally', () => {
  const layout = read('apps/mobile/app/_layout.tsx');
  assert.match(layout, /stageForegroundJobs\(\[/);
  assert.match(layout, /delayMs: 180[\s\S]*resumePairingRealtime/);

  const realtime = read('apps/mobile/src/lib/pairing-realtime.ts');
  assert.match(realtime, /async function reconcileConnection/);
  assert.match(realtime, /fetchConnectionHistory\(\{ incremental: true \}\)/);
  assert.match(realtime, /shouldFetchDashboard[\s\S]*fetchInsights\(\)/);
  assert.match(realtime, /knownChanged: true/);
});

test('retired Scenes and Outfits redirect to current Shop without duplicate catalogue reads', () => {
  for (const file of [
    'apps/mobile/app/(main)/(modals)/scene-select.tsx',
    'apps/mobile/app/(main)/(modals)/skin-select.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /NativeTabRedirect href="\/\(main\)\/\(tabs\)\/shop"/);
    assert.doesNotMatch(source, /fetch|preload|useFocusEffect/);
  }
});
