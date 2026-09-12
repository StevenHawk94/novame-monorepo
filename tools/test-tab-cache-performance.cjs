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
    'apps/mobile/app/(main)/(tabs)/status.tsx',
  ]) {
    assert.match(read(file), /afterUiSettles\(/, `${file} must defer focus reconciliation`);
  }
});

test('Home ignores unrelated R2 completions and Focus settlement does not force its render', () => {
  const home = read('apps/mobile/app/(main)/(tabs)/index.tsx');
  assert.match(home, /useR2AssetRevision\(selectedSceneRemoteUrl\)/);
  assert.doesNotMatch(home, /setCosmeticTick/);
  assert.match(home, /sameMemoryBubbles/);

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

test('Scenes and Outfits postpone catalog reads and speculative image warming', () => {
  for (const file of [
    'apps/mobile/app/(main)/(modals)/scene-select.tsx',
    'apps/mobile/app/(main)/(modals)/skin-select.tsx',
  ]) {
    const source = read(file);
    assert.ok((source.match(/afterUiSettles\(/g) || []).length >= 2, file);
    assert.match(source, /delayMs: 100/);
    assert.match(source, /delayMs: 140/);
  }
});
