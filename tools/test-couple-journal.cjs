const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, flush } = require('./lifecycle-test-utils.cjs');

const root = path.resolve(__dirname, '..');

test('Couple Journal seeds fifty distinct prompts and isolates one answer per author and pairing generation', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261001000151_couple_journal.sql'), 'utf8');
  const seeds = [...sql.matchAll(/\('cj_(\d{2})',(\d+),'([^']+)'\)/g)];
  assert.equal(seeds.length, 50);
  assert.deepEqual(seeds.map(match => Number(match[2])), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.equal(new Set(seeds.map(match => match[3])).size, 50);
  assert.match(sql, /unique\(pair_low,pair_high,pair_version,local_date\)/);
  assert.match(sql, /unique\(page_id,author_id\)/);
  assert.match(sql, /p\.local_date<least\(v_today,coalesce\(p_before_date,v_today\)\)/);
  assert.match(sql, /exists\(select 1 from public\.couple_journal_answers/);
  assert.match(sql, /p_expected_updated_at is distinct from v_answer\.updated_at/);
});

test('solo journal pages remain private and map icons resolve to bundled files', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261001000152_couple_journal_solo.sql'), 'utf8');
  assert.match(sql, /check \(pair_low <= pair_high\)/);
  assert.match(sql, /v_low:=p_user_id; v_high:=p_user_id; v_version:='solo'/);
  assert.match(sql, /'private',p\.pair_low=p\.pair_high/);
  assert.match(sql, /p\.pair_low=p_user_id and p\.pair_high=p_user_id and p\.pair_version='solo'/);
  const source = fs.readFileSync(path.join(root, 'apps/mobile/src/lib/burrow-ui-assets.ts'), 'utf8');
  for (const [, asset] of source.matchAll(/require\('\.\.\/\.\.\/assets\/burrow-webp\/burrow page icons\/([^']+)'\)/g)) {
    assert.ok(fs.existsSync(path.join(root, 'apps/mobile/assets/burrow-webp/burrow page icons', asset)), asset);
  }
});

test('cached page is immediate on the same day and invalid at pair or date change', () => {
  const journal = load('apps/mobile/src/lib/couple-journal.ts', {
    './storage': { storage: { getString() {}, set() {} } },
    '../shared/storage/keys': { kBurrowJournal: { keyFor: value => value } },
    './api': { apiClient: {} },
    './async-lifecycle': { withDeadline: value => value },
    './session-lifecycle': { sessionUserId: () => 'pair-one', sessionEpoch: () => 0, subscribeSessionIdentity: () => () => {} },
  });
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const example = { todayDate: today, timezone: 'UTC', today: { id: 'page' }, history: [] };
  journal.cacheCoupleJournal('pair-one', example);
  assert.equal(journal.cachedCoupleJournal('pair-one'), example);
  assert.equal(journal.cachedCoupleJournal('pair-two'), null);
  journal.cacheCoupleJournal('pair-one', { ...example, todayDate: '2026-01-01' });
  assert.equal(journal.cachedCoupleJournal('pair-one'), null);
});

test('today stays visible after save; history shows one writer and lets the other add an answer', async () => {
  const h = hooks();
  const jsx = (type, props) => ({ type, props });
  const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
    : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
  let data = { profile: { id: 'me', display_name: 'Me' }, partner: { id: 'alex', display_name: 'Alex' }, pairVersion: 'v1' };
  const today = { id: 'today', date: '2026-10-01', pageNumber: 13, questionId: 'cj_01',
    question: 'What small thing made you feel close to me this week?', answers: [] };
  const past = { id: 'past', date: '2026-09-30', pageNumber: 12, questionId: 'cj_02',
    question: 'When did we make each other laugh lately?', answers: [
      { id: 'a1', authorId: 'alex', body: 'Our walk home.', createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z' },
    ] };
  let snapshot = { today, history: [past], hasMore: false, nextBefore: null,
    todayDate: '2026-10-01', timezone: 'UTC', pairVersion: 'v1' };
  const writes = [];
  const { CoupleJournalScreen } = load('apps/mobile/src/components/burrow/couple-journal-screen.tsx', {
    '@react-navigation/native': { useIsFocused: () => true },
    '@/lib/burrow-text-drafts': { readBurrowTextDraft: () => null, keepBurrowTextDraft: (_scope, _page, body, expectedUpdatedAt) => ({ key: 'idempotency-key', body, expectedUpdatedAt }), removeBurrowTextDraft() {} },
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': {
      ActivityIndicator: 'ActivityIndicator', AppState: { addEventListener: () => ({ remove() {} }) },
      KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios', select: values => values.ios },
      Pressable: 'Pressable', ScrollView: 'ScrollView', StatusBar: 'StatusBar',
      StyleSheet: { create: values => values, absoluteFillObject: {} }, Text: 'Text', TextInput: 'TextInput',
      View: 'View', useWindowDimensions: () => ({ width: 393, height: 852 }),
    },
    './burrow-image': { Image: 'Image' },
    'expo-crypto': { randomUUID: () => 'idempotency-key' },
    'expo-router': { router: { back() {} }, useFocusEffect() {} },
    '@expo/vector-icons': { Feather: 'Feather' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/lib/burrow-store': { useBurrow: () => ({ data }) },
    '@/lib/couple-journal': {
      cachedCoupleJournal: () => snapshot, cacheCoupleJournal() {},
      fetchCoupleJournal: async () => snapshot,
      saveCoupleJournalAnswer: async (pageId, body) => {
        writes.push({ pageId, body });
        return { ...past, answers: [...past.answers, { id: 'mine', authorId: 'me', body,
          createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' }] };
      },
    },
    '../../../assets/burrow-webp/memories-room.webp': 1,
  }, { setInterval: () => 1, clearInterval() {} });
  const render = () => h.render(() => CoupleJournalScreen());
  let tree = render();
  assert.ok(nodes(tree).some(node => node.props?.children === 'Write here...'));
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Open journal history').props.onPress();
  tree = render();
  assert.ok(nodes(tree).some(node => node.props?.children === 'Our walk home.'));
  assert.equal(nodes(tree).filter(node => node.props?.children === 'Write here...').length, 0);
  nodes(tree).find(node => node.props?.accessibilityLabel?.startsWith('Open page 12')).props.onPress();
  tree = render();
  assert.ok(nodes(tree).some(node => node.props?.children === 'Write here...'));
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Write your answer').props.onPress();
  tree = render();
  const input = nodes(tree).find(node => node.type === 'TextInput');
  input.props.onChangeText('I remember laughing too.');
  tree = render();
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Save journal answer').props.onPress();
  await flush();
  assert.deepEqual(writes, [{ pageId: 'past', body: 'I remember laughing too.' }]);
  tree = render();
  assert.ok(nodes(tree).some(node => node.props?.children === 'I remember laughing too.'));
  data = { ...data, partner: null, pairVersion: 'solo' };
  snapshot = { ...snapshot, today: { ...today, private: true }, history: [] };
  render();
  tree = render();
  assert.ok(nodes(tree).some(node => node.props?.children === 'Write here...'));
  assert.equal(nodes(tree).filter(node => node.props?.children === 'Waiting for their words...').length, 0);
});

test('Journal API binds reads and writes to the authenticated user', async () => {
  const calls = [];
  const db = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name === 'couple_journal_snapshot_v1' ? {
      today: { id: 'page' }, history: [], pairVersion: 'pair',
    } : { page: { id: 'page' } }, error: null };
  } };
  const route = load('apps/api/src/app/api/vnext/couple-journal/route.js', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/app-major-update': {
      appMajorUpdateServiceClient: () => db, authenticatedUserId: async () => 'authenticated-person',
      commandStatus: code => code ? 409 : 200, majorUpdateEnabled: async () => true,
    },
  }, { URL });
  const read = await route.GET({ url: 'https://example.test/api/vnext/couple-journal' });
  assert.equal(read.status, 200);
  assert.equal(calls[0].name, 'couple_journal_snapshot_v1');
  assert.equal(calls[0].args.p_user_id, 'authenticated-person');
  const write = await route.POST({ text: async () => JSON.stringify({
    pageId: '11111111-1111-4111-8111-111111111111',
    body: 'A little shared memory.',
    expectedUpdatedAt: null,
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    authorId: 'someone-else',
  }) });
  assert.equal(write.status, 200, JSON.stringify(write));
  assert.equal(calls[1].name, 'save_couple_journal_answer_v1');
  assert.equal(calls[1].args.p_user_id, 'authenticated-person');
  assert.equal(Object.hasOwn(calls[1].args, 'authorId'), false);
});
