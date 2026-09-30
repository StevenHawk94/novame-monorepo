const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, flush } = require('./lifecycle-test-utils.cjs');
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object'
  ? [tree, ...nodes(tree.props?.children)] : tree == null || tree === false ? [] : [tree];
const copy = tree => nodes(tree).filter(node => typeof node === 'string').join(' ');

function cardHarness(visit) {
  const commands = [], routes = [];
  let response = {};
  const { FriendVisitCard } = load('apps/mobile/src/components/burrow/friend-visit-card.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Alert: {}, Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: x => x } },
    'expo-image': { Image: 'Image' },
    '@/lib/burrow-ui-assets': { burrowFriendArt: () => null },
    'expo-router': { router: { push: route => routes.push(route) } },
    '@/lib/app-major-update-api': { respondFriendVisit: async (id, input) => { commands.push({ id, input }); return response; } },
    '@/lib/burrow-store': { runBurrowAction: async (_, action) => { await action(); return true; } },
  });
  const data = { profile: { id: 'a' }, friendVisit: visit, friendVisitTimezone: 'UTC',
    friends: [{ stable_id: 'mole', name: 'Mr. Mole' }], catalog: [{ stable_id: 'lamp', title: 'Firefly Lantern' }] };
  return { commands, routes, data, response: value => { response = value; },
    render: (busy = false) => FriendVisitCard({ data, busy }),
    press(label) { const button = nodes(FriendVisitCard({ data, busy: false })).find(node => node.type === 'Pressable' && copy(node).includes(label)); assert.ok(button, label); button.props.onPress(); },
  };
}
const visit = kind => ({ id: 'visit-1', friend_id: 'mole', completed_at: null, declined_at: null, accepted_at: null,
  content_snapshot: { content_type: kind, prompt: 'A little story', choices: [{ id: 'yes', label: 'Yes, keep it' }],
    feedback: { yes: 'A bright little memory.' }, rage_monster_id: 'overthinking' } });

test('empty visitor state explains cadence without presenting a claim button', () => {
  const h = cardHarness(null);
  assert.match(copy(h.render()), /seven days/);
  assert.equal(nodes(h.render()).filter(node => node.type === 'Pressable').length, 0);
});
test('insight acknowledgement is sent to the server and busy disables submission', async () => {
  const h = cardHarness(visit('insight'));
  h.press('Collect gift'); await flush();
  assert.equal(h.commands[0].id, 'visit-1'); assert.equal(h.commands[0].input.acknowledged, true);
  assert.ok(nodes(h.render(true)).filter(node => node.type === 'Pressable').every(node => node.props.disabled));
});
test('question submits the stable choice ID; completed card recalls feedback and recipient gift', async () => {
  const h = cardHarness(visit('question'));
  h.press('Yes, keep it'); await flush(); assert.equal(h.commands[0].input.choiceId, 'yes');
  Object.assign(h.data.friendVisit, { completed_at: 'now', response: { choiceId: 'yes' }, reward_item_id: 'lamp', reward_recipient_id: 'a' });
  assert.match(copy(h.render()), /A bright little memory/); assert.match(copy(h.render()), /You received Firefly Lantern/);
  assert.equal(nodes(h.render()).filter(node => node.type === 'Pressable').length, 0);
});
test('emotional-help acceptance navigates to the exact monster only after server acknowledgement', async () => {
  const h = cardHarness(visit('emotional_help')); h.response({ battleRequired: true });
  h.press('Yes, let’s help'); assert.equal(h.routes.length, 0); await flush();
  assert.equal(h.routes[0].params.monsterId, 'overthinking'); assert.equal(h.routes[0].params.friendVisitId, 'visit-1');
});
test('accepted emotional visit retains both return-to-battle and server-verified collection actions', async () => {
  const row = visit('emotional_help'); row.accepted_at = 'now'; const h = cardHarness(row);
  h.press('Continue helping'); assert.equal(h.routes.length, 1); assert.equal(h.commands.length, 0);
  h.press('I’ve finished'); await flush(); assert.equal(h.commands[0].input.choiceId, 'yes');
});

function apiHarness(file, enabled = true, authorized = true) {
  const calls = [];
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { applied: true }, error: null }; } };
  const route = load(file, {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } },
    '@/lib/auth-guard': { verifyToken: async () => authorized ? { id: '00000000-0000-0000-0000-000000000001' } : null },
    '@supabase/supabase-js': { createClient: () => supabase },
    '@/lib/app-major-update': { appMajorUpdateServiceClient: () => supabase,
      authenticatedUserId: async () => authorized ? '00000000-0000-0000-0000-000000000001' : null,
      majorUpdateEnabled: async () => enabled, commandStatus: () => 200 },
    '@/lib/user-local-date': { resolveUserLocalDate: async () => '2026-09-27' },
    '@/lib/companion-boundary': { runCompanionDependentRpc: async (_, name, args) => { calls.push({ name, args }); return { data: { xp_awarded: args.p_xp_amount } }; } },
    '@novame/domain': { LENS_THEME_KEYS: ['care'], DIMENSION_IDS: ['a', 'b'] },
    '@novame/engine': { XP_RULES: { newLens: { award: 20 }, quietWins: { award: 20 }, trueNorth: { award: 30 } }, MONSTERS: [{ id: 'overthinking' }] },
  }, { process: { env: {} }, crypto: { randomUUID: () => 'period-1' } });
  return { calls, post: body => route.POST({ headers: { get: () => 'Bearer test' }, text: async () => JSON.stringify(body), json: async () => body }) };
}
const commandRoute = 'apps/api/src/app/api/vnext/command/route.js';
test('room activity API binds writes to authenticated identity, ignoring forged user ID', async () => {
  const h = apiHarness(commandRoute);
  await h.post({ action: 'set_room_sleep', sleeping: true, idempotencyKey: 'key', userId: 'forged' });
  assert.equal(h.calls[0].name, 'set_room_sleep_v1');
  assert.equal(h.calls[0].args.p_user_id, '00000000-0000-0000-0000-000000000001');
});
test('room activity API rejects invalid types, malformed visit IDs and disabled/unauthenticated requests', async () => {
  for (const body of [{ action: 'set_room_sleep', sleeping: 'true', idempotencyKey: 'key' },
    { action: 'respond_friend_visit', visitId: 'bad', response: {} }]) {
    const h = apiHarness(commandRoute); assert.equal((await h.post(body)).status, 400); assert.equal(h.calls.length, 0);
  }
  const disabled = apiHarness(commandRoute, false);
  assert.equal((await disabled.post({ action: 'set_room_sleep' })).status, 403); assert.equal(disabled.calls.length, 0);
  const unauthenticated = apiHarness(commandRoute, true, false);
  assert.equal((await unauthenticated.post({})).status, 401); assert.equal(unauthenticated.calls.length, 0);
});
for (const [file, body, oldReward] of [
  ['lens/complete', { theme: 'care', cardOrder: 1, cardId: 'card', response: 'resonates' }, 20],
  ['kit/quiet-wins', { checkedIds: [] }, 20],
  ['kit/true-north', { ranking: ['a', 'b'] }, 30],
]) test(`${file}: vNext Self Care preserves completion but passes zero currency; legacy award unchanged`, async () => {
  for (const enabled of [false, true]) {
    const h = apiHarness(`apps/api/src/app/api/${file}/route.js`, enabled);
    const result = await h.post({ userId: '00000000-0000-0000-0000-000000000001', ...body });
    assert.equal(result.status, 200); assert.equal(h.calls[0].args.p_xp_amount, enabled ? 0 : oldReward);
  }
});
test('vNext Rage API routes to its atomic reward RPC, not the legacy XP transaction', async () => {
  const h = apiHarness('apps/api/src/app/api/tame-enemy/route.js');
  const result = await h.post({ userId: '00000000-0000-0000-0000-000000000001', monsterId: 'overthinking',
    skillsUsed: ['overthinking-final-original-4'], hits: 20, idempotencyKey: 'battle-1' });
  assert.equal(result.status, 200); assert.equal(h.calls[0].name, 'submit_burrow_rage_v1');
  assert.equal(h.calls[0].args.p_key, 'battle-1'); assert.equal(h.calls[0].args.p_xp_amount, undefined);
});
