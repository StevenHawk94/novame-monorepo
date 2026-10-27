/* Keyword authoring is retired; Admin pricing and historical art remain. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('current Admin keeps Shop pricing reachable and does not import the retired rule editor', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/app/admin/page.tsx'), 'utf8');
  assert.match(source,/import ShopPricingTab/); assert.match(source,/<ShopPricingTab/);
  assert.doesNotMatch(source,/ItemsTab|ItemRuleEditor|Publish batch|Download CSV template/);
});

test('retired keyword authoring helpers cannot be imported by Admin', () => {
  for (const name of ['item-review', 'item-manifest', 'item-keyword-batch', 'item-catalog'])
    assert.equal(fs.existsSync(path.join(root, 'apps/admin/src/lib', name + '.js')), false);
  const atlas = require('../apps/admin/src/generated/item-atlas.json');
  assert.equal(atlas.count, 5439);
  assert.ok(fs.readdirSync(path.join(root, 'apps/admin/public/item-atlas')).length > 0);
});
