const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');

const { momentKind, momentDescription, momentLocalDate } = load('apps/mobile/src/lib/burrow-moments-model.ts');
const row = (event_type, payload = {}) => ({ id: event_type, actor_id: 'me', event_type, payload,
  created_at: '2026-10-02T16:12:00Z', localDate: '2026-10-02' });

test('Moments maps only the nine completed activity classes', () => {
  assert.equal(momentKind(row('room_need_refilled', { need: 'water' })), 'water');
  assert.equal(momentKind(row('room_need_refilled', { need: 'food' })), 'feed');
  assert.equal(momentKind(row('memory_created')), 'journal');
  assert.equal(momentKind(row('memory_created', { kind: 'love_note' })), 'letter');
  assert.equal(momentKind(row('affection_sent')), 'affection');
  assert.equal(momentKind(row('game_played')), 'game');
  assert.equal(momentKind(row('adventure_record_saved', { journalKind: 'tap_your_day' })), 'log-day');
  assert.equal(momentKind(row('toy_interacted')), 'toy');
  assert.equal(momentKind(row('rage_room_completed')), 'rage');
  assert.equal(momentKind(row('room_media_updated')), null);
  assert.equal(momentKind(row('room_decor_changed')), null);
});

test('Moments uses actor and toy touch count in visible copy', () => {
  assert.equal(momentDescription(row('toy_interacted', { count: 7 }), 'me', 'Alex'), 'You played with the toy · 7 touches');
  assert.equal(momentDescription({ ...row('affection_sent', { affectionType: 'kiss' }), actor_id: 'alex' }, 'me', 'Alex'), 'Alex sent you a kiss');
  assert.equal(momentLocalDate('2026-10-02T06:00:00Z', 'America/Los_Angeles'), '2026-10-01');
});

test('the nine supplied cropped icon files are genuine WebP images', () => {
  const folder = path.join(__dirname, '../apps/mobile/assets/burrow-webp/moments-icons');
  for (const name of ['water', 'feed', 'journal', 'affection', 'game', 'log-day', 'letter', 'toy', 'rage']) {
    const bytes = fs.readFileSync(path.join(folder, `${name}.webp`));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
});

test('focus fetch keeps cached Moments visible without showing pull-to-refresh', async () => {
  const h = hooks();
  const waiting = deferred();
  const jsx = (type, props) => ({ type, props });
  const model = { momentKind, momentDescription, momentLocalDate };
  const component = load('apps/mobile/src/components/burrow/moments-timeline.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) }, Pressable: 'Pressable',
      RefreshControl: 'RefreshControl', SectionList: 'SectionList', ScrollView: 'ScrollView', StyleSheet: { create: value => value, absoluteFillObject: {} },
      Text: 'Text', View: 'View' },
'./burrow-image': { Image: 'Image' }, 'expo-image': { Image: 'Image' }, '@expo/vector-icons': { Feather: 'Feather' },
    'expo-router': { router: { canGoBack: () => true, back() {} } },
    '@react-navigation/native': { useIsFocused: () => true },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) },
    '@/lib/burrow-art-assets': { BURROW_BACKGROUNDS: { common: 'background' } },
    '@/lib/burrow-history': { fetchBurrowHistory: () => waiting.promise, historyDayLabel: () => 'Today',
      mergeHistory: (a, b) => [...a, ...b] },
    '@/lib/burrow-moments-model': model,
    '@/lib/burrow-ui-assets': { BURROW_MOMENT_ICONS: { water: 'water' } },
    '@/lib/item-images.g': { ITEM_IMAGES: {} },
    '@/lib/session-lifecycle': { sessionEpoch: () => 1 },
  });
  const data = { profile: { id: 'me', timezone_name: 'UTC', avatar_url: null },
    partner: { id: 'alex', display_name: 'Alex', avatar_url: null }, localDate: '2026-10-02',
    moments: [row('room_need_refilled', { need: 'water' })] };
  const scroll = () => h.render(() => component.MomentsTimeline({ data })).props.children[2];
  const first = scroll();
  assert.equal(first.type, 'SectionList');
  assert.equal(first.props.refreshControl.props.refreshing, false);
  const pending = scroll();
  assert.equal(pending.props.refreshControl.props.refreshing, false);
  assert.equal(pending.props.sections[0].data.length, 1);
  pending.props.refreshControl.props.onRefresh();
  assert.equal(scroll().props.refreshControl.props.refreshing, true);
  waiting.resolve({ rows: [], next: null, hasMore: false, timezone: 'UTC' });
  await flush();
  assert.equal(scroll().props.refreshControl.props.refreshing, false);
  h.unmount();
});
