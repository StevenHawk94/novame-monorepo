const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, flush } = require('./lifecycle-test-utils.cjs');

const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];

test('music page is full screen, selects real tracks instantly and can mute', async () => {
  const h = hooks();
  const react = { ...h.react, useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const choices = [];
  const room = { profile: { id: 'me' }, musicTrackId: null, catalog: [
    { stable_id: 'calm', item_type: 'music', title: 'Quiet Burrow', asset: { bundleKey: 'calm' }, price: 0 },
    { stable_id: 'dream', item_type: 'music', title: 'Little Daydream', asset: { bundleKey: 'dream' }, price: 80 },
  ], inventory: [{ owner_id: 'me', item_id: 'calm' }] };
  const { BurrowMusicPicker } = load('apps/mobile/src/components/burrow/burrow-music.tsx', {
    '@/lib/latest-selection-queue': load('apps/mobile/src/lib/latest-selection-queue.ts'),
    '@/lib/storage': { storage: { getString() {}, set() {} } },
    '@/shared/storage/keys': { kBurrowMusicMuted: { name: 'music-muted' } },
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AppState: {}, Alert: { alert() {} }, Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView',
      StatusBar: 'StatusBar', StyleSheet: { create: value => value, absoluteFillObject: {} }, Text: 'Text', View: 'View' },
    'expo-audio': { createAudioPlayer() {}, setAudioModeAsync() {} },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    '@expo/vector-icons': { Feather: 'Feather', MaterialCommunityIcons: 'MaterialCommunityIcons' },
    'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 50, bottom: 30 }) },
    '@/lib/burrow-audio-controller': { createBurrowAudioController() {} },
    '@/lib/burrow-store': { useBurrowSnapshot: () => ({ data: room, busy: false, error: null }),
      selectBurrowMusicLocally: id => { room.musicTrackId = id; },
      confirmBurrowMusicLocally() {}, scheduleBurrowRefresh() {},
      runBurrowAction: async (_key, action) => { await action(); return true; }, refreshBurrow() {}, burrowErrorMessage: value => value },
    '@/lib/app-major-update-api': { selectRoomMusic: async id => { choices.push(id); } },
    '@/lib/use-major-update': { useMajorUpdateEnabled: () => true },
    '@/lib/session-lifecycle': { sessionEpoch: () => 1, subscribeSessionIdentity: () => () => {} },
    '@/lib/haptics': { haptics: { light: async () => {} } },
    '../../../assets/burrow/calm.wav': 1, '../../../assets/burrow/dream.wav': 2,
  });
  const render = () => h.render(() => BurrowMusicPicker({ data: room, onClose() {} }));
  let tree = render();
  assert.equal(tree.type, 'Modal');
  assert.equal(tree.props.presentationStyle, 'fullScreen');
  assert.ok(nodes(tree).some(node => node.props?.children === 'No music'));
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Quiet Burrow').props.onPress();
  await flush();
  assert.deepEqual(choices, ['calm']);
  tree = render();
  assert.ok(nodes(tree).some(node => node.props?.children === 'Playing in your room'));
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Mute music').props.onPress();
  tree = render();
  assert.ok(nodes(tree).some(node => node.props?.children === 'Paused in your room'));
  assert.ok(nodes(tree).some(node => node.props?.accessibilityLabel === 'Unmute music'));
});
