const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');
const {
  HOME_ART_HEIGHT, HOME_ART_WIDTH, HOME_LIGHT_STRING_TOP, HOME_MAX_TOP_CROP,
  homeArtLayout, decorationPreviewLayout, homeAnchoredBox, HOME_ART_PLACEMENTS,
  homeTabBarHeight, HOME_TAB_BAR_TOP_SPACE,
} = load('apps/mobile/src/lib/burrow-home-layout.ts');

test('Home tabs add twelve points of top headroom without changing safe-bottom space', () => {
  assert.equal(HOME_TAB_BAR_TOP_SPACE, 12);
  for (const [width, safeBottom] of [[320, 0], [375, 0], [390, 34], [430, 34], [768, 20]]) {
    const previousHeight = Math.max(160 * width / HOME_ART_WIDTH, safeBottom + 44);
    assert.ok(homeTabBarHeight(width, safeBottom) - previousHeight >= 12);
    const iconAndLabelHeight = (64 + 28) * width / HOME_ART_WIDTH + 2;
    assert.ok(homeTabBarHeight(width, safeBottom) - safeBottom >= iconAndLabelHeight + HOME_TAB_BAR_TOP_SPACE + 1);
  }
});

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

test('flower variants use identical canvas scale and center while staying on the table', () => {
  const placement = HOME_ART_PLACEMENTS.find(item => item.slot === 'vase');
  const bounds = [[74, 38, 427, 500], [92, 16, 422, 500], [53, 3, 446, 500]];
  for (const scale of [.35, .5, 1]) {
    const boxes = bounds.map(bounds => homeAnchoredBox({ width: 500, height: 500, bounds }, placement, scale));
    for (const box of boxes) {
      assert.equal(box.width, boxes[0].width);
      assert.equal(box.height, boxes[0].height);
      assert.equal(box.left, boxes[0].left);
      assert.ok(Math.abs(box.top + box.height - placement.anchorY * scale) < 1e-8);
      assert.ok(Math.abs(box.width - 500 * 140 / 353 * scale) < 1e-8);
    }
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
