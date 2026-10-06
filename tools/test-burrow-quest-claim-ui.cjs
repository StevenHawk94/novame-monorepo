const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, deferred, flush, clock } = require('./lifecycle-test-utils.cjs');

const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];

test('Quest claim immediately restores gray/struck-through completed state without a check icon', async () => {
  const h = hooks(), request = deferred();
  const { QuestBoard } = load('apps/mobile/src/components/burrow/quest-board.tsx', {
    './burrow-image': { Image: 'Image' },
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Image: 'Image', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: styles => styles } },
    '@/lib/burrow-ui-assets': { BURROW_QUEST_ICONS: {} },
    './care-quest-celebration': { QuestClaimBurst: 'QuestClaimBurst' },
  });
  const data = { profile: { id: 'me' }, localDate: '2026-10-02', quests: { quests: [{ assignmentId: 'assignment-1', questId: 'send_affection',
    target: 1, progress: 1, completedAt: 'today', claimedAt: null }] }, specialQuests: [], inventory: [], discoveries: [] };
  const render = () => h.render(() => QuestBoard({ data, busy: false, onGo() {}, onClaim: () => request.promise,
    onSpecialClaim: async () => 0, onSpecialGo() {} }));
  let tree = render();
  const card = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  assert.ok(nodes(card).some(node => node.props?.children === 'Claim'));
  card.props.onPress();
  tree = render();
  const claimed = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  assert.equal(claimed.props.disabled, true);
  assert.equal(claimed.props.style({ pressed: false })[1].backgroundColor, '#C9B2A2');
  const title = nodes(claimed).find(node => node.props?.children === 'Send your person affection');
  assert.equal(title.props.style[1].textDecorationLine, 'line-through');
  assert.ok(!nodes(claimed).some(node => node.props?.children === '✓' || node.props?.children === 'Claim'));
  assert.equal(nodes(tree).find(node => node.type === 'QuestClaimBurst').props.reward, 10);
  request.resolve(10); await flush();
  assert.equal(render().type, 'View');
});

test('failed optimistic claim restores Claim without restoring an unchecked task; double taps dispatch once', async () => {
  const h = hooks(), request = deferred(), time = clock(); let calls = 0;
  const { QuestBoard } = load('apps/mobile/src/components/burrow/quest-board.tsx', {
    './burrow-image': { Image: 'Image' }, react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '@/lib/burrow-ui-assets': { BURROW_QUEST_ICONS: {} }, './care-quest-celebration': { QuestClaimBurst: 'QuestClaimBurst' },
  }, time.globals);
  const data = { profile: { id: 'me' }, localDate: '2026-10-05', quests: { quests: [{ assignmentId: 'one', questId: 'send_affection', target: 1, progress: 1, completedAt: 'today', claimedAt: null }] }, specialQuests: [], inventory: [], discoveries: [] };
  const render = () => h.render(() => QuestBoard({ data, busy: false, onGo() {}, onClaim: () => { calls++; return request.promise; }, onSpecialGo() {}, onSpecialClaim: async () => 0 }));
  let tree = render(), card = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  card.props.onPress(); card.props.onPress(); assert.equal(calls, 1);
  request.reject(Error('offline')); await flush(); tree = render();
  card = nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Send your person affection'));
  assert.ok(nodes(card).some(node => node.props?.children === 'Claim'));
  assert.equal(nodes(card).find(node => node.props?.children === 'Send your person affection').props.style[1].textDecorationLine, 'line-through');
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert')); h.unmount();
});
