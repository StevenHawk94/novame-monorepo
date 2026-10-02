const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

const warp = load('apps/mobile/src/lib/burrow-toy-warp.ts');

test('Toy source has transparent pull padding and local influence stops at circle edge', () => {
  assert.ok(warp.TOY_TEXTURE_PADDING >= 60 && warp.TOY_TEXTURE_PADDING <= 80);
  assert.equal(warp.toyInfluence(0, 100), 1);
  assert.ok(warp.toyInfluence(50, 100) > 0 && warp.toyInfluence(50, 100) < 1);
  assert.equal(warp.toyInfluence(100, 100), 0);
  assert.equal(warp.toyInfluence(130, 100), 0);
});

test('Toy pull never exceeds fifteen percent of head width', () => {
  const headWidth = 200;
  const gentle = warp.clampToyPull(12, 0, headWidth);
  assert.equal(gentle.x, 12);
  assert.equal(gentle.y, 0);
  const pull = warp.clampToyPull(120, 160, headWidth);
  assert.ok(Math.hypot(pull.x, pull.y) <= headWidth * .15 + 1e-8);
  assert.ok(pull.y > pull.x);
});

test('Toy local-warp shader compiles against the installed Skia runtime', async () => {
  const { LoadSkiaWeb } = require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb');
  const { getSkiaExports } = require('../apps/mobile/node_modules/@shopify/react-native-skia/lib/commonjs/headless');
  await LoadSkiaWeb();
  assert.ok(getSkiaExports().Skia.RuntimeEffect.Make(warp.TOY_WARP_SKSL));
});
