const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');
const {
  HOME_ART_HEIGHT, HOME_ART_WIDTH, HOME_LIGHT_STRING_TOP, HOME_MAX_TOP_CROP,
  homeArtLayout, decorationPreviewLayout,
} = load('apps/mobile/src/lib/burrow-home-layout.ts');

test('Home keeps the string lights on-screen across compact, tall and tablet layouts', () => {
  const screens = [
    { width: 320, height: 478, tab: 90 },
    { width: 375, height: 680, tab: 90 },
    { width: 390, height: 754, tab: 90 },
    { width: 430, height: 780, tab: 90 },
    { width: 768, height: 900, tab: 136 },
  ];
  for (const screen of screens) {
    const layout = homeArtLayout(screen.width, screen.height, screen.tab);
    assert.ok(layout.artWidth <= screen.width + .001, `width ${screen.width}`);
    assert.ok(layout.cropTop <= HOME_MAX_TOP_CROP * layout.scale + .001, `crop ${screen.width}`);
    assert.ok(HOME_LIGHT_STRING_TOP * layout.scale > layout.cropTop, `string lights ${screen.width}`);
    assert.equal(layout.artWidth, HOME_ART_WIDTH * layout.scale);
    assert.equal(layout.artHeight, HOME_ART_HEIGHT * layout.scale);
    assert.ok(layout.left >= 0);
  }
});

test('decoration preview uses the same proportions and dims only the exposed margins', () => {
  for (const [width, height] of [[284, 448], [354, 680], [524, 900]]) {
    const preview = decorationPreviewLayout(width, height);
    assert.ok(preview.artWidth <= width + .001);
    assert.ok(preview.viewportHeight <= height);
    assert.ok(preview.cropTop <= HOME_MAX_TOP_CROP * preview.scale + .001);
    assert.ok(HOME_LIGHT_STRING_TOP * preview.scale > preview.cropTop);
    assert.equal(preview.artHeight / preview.artWidth, HOME_ART_HEIGHT / HOME_ART_WIDTH);
  }
});
