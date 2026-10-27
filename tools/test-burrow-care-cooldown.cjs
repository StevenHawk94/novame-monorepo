const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

const care = load('apps/mobile/src/lib/burrow-care-cooldown.ts');
const now = Date.parse('2026-10-01T20:00:00Z');
const data = (food, water, moments = []) => ({ profile: { id: 'me' },
  lastCareAt: { food, water }, moments });

test('food and water cool down independently for exactly twelve hours', () => {
  const state = data(new Date(now - 11 * 3600_000).toISOString(), null);
  assert.equal(care.careCoolingDown(state, 'food', now), true);
  assert.equal(care.careCoolingDown(state, 'water', now), false);
  assert.equal(care.careCoolingDown(state, 'food', now + 3600_000), false);
});

test('activity-feed fallback and immediate local success both prevent a second attempt', () => {
  const state = data(null, null, [{ actor_id: 'me', target_id: 'me', event_type: 'room_need_refilled',
    created_at: new Date(now - 1000).toISOString(), payload: { need: 'water' } }]);
  assert.equal(care.careCoolingDown(state, 'water', now), true);
  care.markCareCompleted('me', 'food', now);
  assert.equal(care.careCoolingDown(state, 'food', now + 1000), true);
  assert.equal(care.careCoolingDown(state, 'food', now + care.CARE_COOLDOWN_MS), false);
  assert.equal(care.careCooldownMessage('food'), 'Your bunny is full and happy.');
  assert.equal(care.careCooldownMessage('water'), 'Your flower is fresh and growing.');
});

test('initial full own/partner rooms are blocked without a historical care event, using server five-minute decay',()=>{
 const care=load('apps/mobile/src/lib/burrow-care-cooldown.ts');
 for(const owner of ['me','partner'])for(const need of ['food','water']){
  const state={...data(null,null),partner:{id:'partner'},serverNow:new Date(now).toISOString(),
   roomNeeds:{food:100,water:100,serverNow:new Date(now).toISOString()},
   partnerNeeds:{foodValue:100,waterValue:100,foodUpdatedAt:new Date(now).toISOString(),waterUpdatedAt:new Date(now).toISOString()}};
  assert.equal(care.careCoolingDown(state,need,now+299_999,owner),true);
  assert.equal(care.careCoolingDown(state,need,now+300_000,owner),false);
 }
});
test('pending saves block reopening independently by owner/need/pair and release on failure without a cooldown',()=>{
 const care=load('apps/mobile/src/lib/burrow-care-cooldown.ts'),state={...data(null,null),partner:{id:'partner'},pairVersion:'one'};
 const release=care.beginCareSubmission(state,'food','partner');
 assert.equal(care.careCoolingDown(state,'food',now,'partner'),true);
 assert.equal(care.careCoolingDown(state,'food',now,'me'),false);
 assert.equal(care.careCoolingDown(state,'water',now,'partner'),false);
 assert.equal(care.careCoolingDown({...state,pairVersion:'two'},'food',now,'partner'),false);
 release();assert.equal(care.careCoolingDown(state,'food',now,'partner'),false);
});
