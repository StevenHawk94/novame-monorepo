const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

function setup() {
  const values = new Map([
    ['custom-tap-items:v1:6f71573c-46ac-4f7c-9fb2-423770212688', 'private choices'],
    ['reviewed-item-rules:v33-8a1a98aedd3763b1', 'public rules'],
    ['reviewed-item-rules:v32-older', 'older public rules'],
  ]);
  const errors = [];
  const registry = load('apps/mobile/src/shared/storage/registry.ts', {
    './mmkv': { mmkv: { getAllKeys: () => [...values.keys()], remove: key => values.delete(key) } },
  }, { __DEV__: true, console: { error: x => errors.push(x), log() {}, warn() {} } });
  const keys = load('apps/mobile/src/shared/storage/keys.ts', {
    './registry': registry, './artifacts': { deleteRecordDraftAudio() {} },
  });
  return { values, errors, registry, keys };
}

test('existing MMKV bytes survive registering the two exact prefixes, including older rule versions', () => {
  const h = setup();
  h.registry.assertAllKeysRegistered();
  assert.equal(h.errors.length, 0);
  assert.equal(h.values.size, 3);
  assert.equal(h.keys.kCustomTapItems.scope, 'user');
  assert.equal(h.keys.kCustomTapItems.keyFor('uuid'), 'custom-tap-items:v1:uuid');
  assert.equal(h.keys.kReviewedItemRules.scope, 'device');
  assert.equal(h.keys.kReviewedItemRules.keyFor('catalog'), 'reviewed-item-rules:catalog');
});

test('actual sign-out/account switch clears private choices, but not public reviewed rules', () => {
  for (const action of ['clearOnSignOut', 'clearOnSignIn']) {
    const h = setup(); h.registry[action]();
    assert.equal(h.values.size, 2);
    assert.ok([...h.values.keys()].every(key => key.startsWith('reviewed-item-rules:')));
    h.registry.assertAllKeysRegistered(); assert.equal(h.errors.length, 0);
  }
});

test('registration does not silence the safeguard for genuinely unknown keys', () => {
  const h = setup(); h.values.set('unregistered-private-value', 'sensitive');
  h.registry.assertAllKeysRegistered();
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /unregistered-private-value/);
});
