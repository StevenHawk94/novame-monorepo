const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('TikTok App Events SDK is iOS-only and pinned', () => {
  const app = JSON.parse(read('apps/mobile/app.json'));
  const moduleConfig = JSON.parse(
    read('apps/mobile/modules/tiktok-events/expo-module.config.json'),
  );
  const podspec = read('apps/mobile/modules/tiktok-events/ios/TikTokEvents.podspec');

  assert.ok(app.expo.plugins.includes('./plugins/with-tiktok-business-sdk'));
  assert.deepEqual(moduleConfig.platforms, ['apple']);
  assert.match(podspec, /TikTokBusinessSDK', '1\.7\.1'/);
  const androidDirectory = path.join(
    root,
    'apps/mobile/modules/tiktok-events/android',
  );
  const androidFiles = fs.existsSync(androidDirectory)
    ? fs.readdirSync(androidDirectory, { recursive: true })
      .filter((entry) => fs.statSync(path.join(androidDirectory, entry)).isFile())
    : [];
  assert.deepEqual(androidFiles, []);
});

test('native bridge keeps ATT and enhanced-data collection disabled while SKAN stays enabled', () => {
  const bridge = read(
    'apps/mobile/modules/tiktok-events/ios/TikTokEventsModule.swift',
  );

  assert.match(bridge, /disableAutoEnhancedDataPostbackEvent\(\)/);
  assert.match(bridge, /disablePaymentTracking\(\)/);
  assert.doesNotMatch(bridge, /disableSKAdNetworkSupport/);
  assert.doesNotMatch(bridge, /ATTrackingManager|requestTrackingAuthorization/);
  assert.doesNotMatch(bridge, /identify\s*\(/i);
});

test('TikTok event surface contains only the approved funnel events and properties', () => {
  const analytics = read('apps/mobile/src/lib/tiktok-analytics.ts');
  const trackedNames = [
    ...analytics.matchAll(/track\('([^']+)'/g),
  ].map((match) => match[1]);

  assert.deepEqual(trackedNames, [
    'CompleteTutorial',
    'JournalCompleted',
    'Registration',
    'StartTrial',
    'Subscribe',
  ]);
  assert.match(analytics, /journal_type: journalKind/);
  assert.match(analytics, /content_id: params\.productId/);
  assert.match(analytics, /content_type: 'subscription'/);
  assert.match(analytics, /billing_cycle: params\.cycle/);
  assert.doesNotMatch(analytics, /\b(?:email|name|journal_text|memory|friend|partner)_?(?:id|text|content)?\s*:/i);
  assert.doesNotMatch(analytics, /identify\s*\(/i);
});

test('shared privacy gate controls both Meta and TikTok measurement', () => {
  const aggregate = read('apps/mobile/src/lib/ad-measurement.ts');
  const gate = read(
    'apps/mobile/src/components/privacy/meta-privacy-provider.tsx',
  );

  assert.match(aggregate, /initializeTikTokAnalytics\(\)/);
  assert.match(aggregate, /disableTikTokAnalytics\(\)/);
  assert.match(gate, /initializeAdMeasurement\(\)/);
  assert.match(gate, /disableAdMeasurement\(\)/);
  assert.match(gate, /kAdsPrivacyChoice/);
});

test('native credentials stay out of the JavaScript bundle and are required for EAS iOS builds', () => {
  const pluginPath = path.join(
    root,
    'apps/mobile/plugins/with-tiktok-business-sdk.js',
  );
  const pluginSource = fs.readFileSync(pluginPath, 'utf8');
  const plugin = require(pluginPath);
  const values = Object.keys(plugin.IOS_KEYS);

  assert.deepEqual(values, [
    'TIKTOK_IOS_APP_ID',
    'TIKTOK_IOS_TIKTOK_APP_ID',
    'TIKTOK_IOS_ACCESS_TOKEN',
  ]);
  assert.ok(values.every((key) => !key.startsWith('EXPO_PUBLIC_')));
  assert.match(pluginSource, /EAS_BUILD_PLATFORM/);

  const previousPlatform = process.env.EAS_BUILD_PLATFORM;
  process.env.EAS_BUILD_PLATFORM = 'ios';
  try {
    assert.throws(
      () => plugin.assertCompleteForEas(
        'ios',
        values.map((environmentName) => ({ environmentName, value: '' })),
      ),
      /Missing TikTok ios build credentials/,
    );
  } finally {
    if (previousPlatform === undefined) delete process.env.EAS_BUILD_PLATFORM;
    else process.env.EAS_BUILD_PLATFORM = previousPlatform;
  }
});
