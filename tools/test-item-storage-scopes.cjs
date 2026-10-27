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
  let avatarCleanups=0;
  const registry = load('apps/mobile/src/shared/storage/registry.ts', {
    './mmkv': { mmkv: { getAllKeys: () => [...values.keys()], remove: key => values.delete(key) } },
  }, { __DEV__: true, console: { error: x => errors.push(x), log() {}, warn() {} } });
  const keys = load('apps/mobile/src/shared/storage/keys.ts', {
    './registry': registry, './artifacts': { deleteRecordDraftAudio() {},deleteProfileAvatars(){avatarCleanups++;} },
  });
  return { values, errors, registry, keys,avatarCleanups:()=>avatarCleanups };
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
test('purchase and both versioned room journals are physically cleared by the actual account registry',()=>{
 const h=setup();for(const key of [h.keys.kShopPurchases.name,h.keys.kBurrowRoomEdits.keyFor('A'),h.keys.kPersonalRoomEdits.keyFor('A')])h.values.set(key,'private pending intent');
 h.registry.clearScope('user','test-signout');
 assert.equal(h.values.has(h.keys.kShopPurchases.name),false);assert.equal(h.values.has(h.keys.kBurrowRoomEdits.keyFor('A')),false);assert.equal(h.values.has(h.keys.kPersonalRoomEdits.keyFor('A')),false);
 assert.equal(h.values.get('reviewed-item-rules:v33-8a1a98aedd3763b1'),'public rules');
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

test('local game history is registered as private and is removed on logout/account switch', () => {
  for (const action of ['clearOnSignOut','clearOnSignIn']) {
    const h=setup(), key=h.keys.kGameHistory.keyFor('me:partner:v1');
    h.values.set(key,'completed games');
    h.registry.assertAllKeysRegistered(); assert.equal(h.errors.length,0);
    h.registry[action](); assert.equal(h.values.has(key),false);
  }
});
test('avatar local pointer/account details are private and sign-out also retires their disk directory',()=>{
 const h=setup();h.values.set(h.keys.kProfileAvatar.name,'local avatar pointer');h.values.set(h.keys.kAccountProfile.name,'profile fields');
 h.registry.clearOnSignOut();assert.equal(h.values.has(h.keys.kProfileAvatar.name),false);assert.equal(h.values.has(h.keys.kAccountProfile.name),false);assert.ok(h.avatarCleanups()>0);
});

test('Adventure journal outbox is personal and clears on logout/account switch',()=>{
  for(const action of ['clearOnSignOut','clearOnSignIn']){
    const h=setup(),key=h.keys.kAdventureJournalJobs.name;
    assert.equal(h.keys.kAdventureJournalJobs.scope,'user');h.values.set(key,'private journal and queued start');
    h.registry.assertAllKeysRegistered();assert.equal(h.errors.length,0);
    h.registry[action]();assert.equal(h.values.has(key),false);
  }
});

test('Adventure promotion receipts are registered per account and cleared on logout/account switch',()=>{
  for(const action of ['clearOnSignOut','clearOnSignIn']){
    const h=setup(),key=h.keys.kAdventurePaywall.keyFor('me');
    assert.equal(h.keys.kAdventurePaywall.scope,'user');h.values.set(key,'completion cadence and pending offer');
    h.registry.assertAllKeysRegistered();assert.equal(h.errors.length,0);
    h.registry[action]();assert.equal(h.values.has(key),false);
  }
});

test('official rating milestones and pending requests cannot survive into another account',()=>{
 for(const action of ['clearOnSignOut','clearOnSignIn']){
  const h=setup(),key=h.keys.kOfficialRatingMilestones.keyFor('me');h.values.set(key,'engagement receipts');
  h.registry.assertAllKeysRegistered();assert.equal(h.errors.length,0);h.registry[action]();assert.equal(h.values.has(key),false);
 }
});

test('existing Toy input batches register without losing pending receipts and clear on logout/account switch',()=>{
  for(const action of ['clearOnSignOut','clearOnSignIn']){
    const h=setup(),key='burrow:toy-input-batches:v2',receipt='{"pending":3,"batch":{"id":"retry","count":2}}';
    h.values.set(key,receipt);
    assert.equal(h.keys.kToyInputBatches.name,key);
    assert.equal(h.keys.kToyInputBatches.scope,'user');
    h.registry.assertAllKeysRegistered();assert.equal(h.errors.length,0);
    assert.equal(h.values.get(key),receipt,'registering must preserve current-user retry receipts');
    h.registry[action]();assert.equal(h.values.has(key),false);
    h.registry.assertAllKeysRegistered();assert.equal(h.errors.length,0);
  }
});
