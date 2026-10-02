const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

const { decorationOptions } = load('apps/mobile/src/lib/burrow-collection-options.ts');
const item = (id, category, price, ordinal) => ({ stable_id:id, category, price, metadata:{artOrdinal:ordinal} });
const catalog = [item('mine', 'windows', 120, 3), item('partner', 'windows', 180, 2), item('unowned', 'windows', 200, 1)];
const inventory = [{owner_id:'me',item_id:'mine'},{owner_id:'partner',item_id:'partner'}];

test('Collection decorator exposes only the viewed owner’s purchased items', () => {
  assert.deepEqual(Array.from(decorationOptions(catalog,'windows',true,'me',inventory),value=>value.stable_id),['mine']);
  assert.deepEqual(Array.from(decorationOptions(catalog,'windows',true,'partner',inventory),value=>value.stable_id),['partner']);
});

test('Shop decorator still offers purchasable items in catalog order', () => {
  assert.deepEqual(Array.from(decorationOptions(catalog,'windows',false,'me',inventory),value=>value.stable_id),['unowned','partner','mine']);
});
