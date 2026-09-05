// Native-boundary regressions; device rendering still needs visual QA.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./lifecycle-test-utils.cjs');
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => typeof type === 'function' ? type(props) : ({ type, props });
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];
const texts = tree => Array.isArray(tree) ? tree.flatMap(texts) : typeof tree === 'string' ? [tree] : tree?.props ? texts(tree.props.children) : [];
function native(platform, width = 390) {
  return { Platform: { OS: platform }, ActivityIndicator: 'ActivityIndicator', Image: 'Image',
    Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: value => value, absoluteFillObject: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } },
    useWindowDimensions: () => ({ width, height: 844 }),
  };
}
function setup(platform, { width = 390, tier = 'free', paired = true, gate = 'ok', content = true } = {}) {
  const rn = native(platform, width);
  const typography = load('apps/mobile/src/components/ui/tab-header-typography.ts', { 'react-native': rn });
  const pushes = [], feedback = [];
  const insights = { schemaVersion: 2, modules: { worth_knowing: content ? [{
    label: 'Worth Noticing', title: null, observation: 'Private paid insight', meaning: null, takeaway: null,
  }] : [] } };
  const { default: Screen } = load('apps/mobile/app/(main)/(tabs)/status.tsx', {
    react: { useCallback: fn => fn, useEffect() {}, useRef: value => ({ current: value }),
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': rn,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    'expo-router': { useFocusEffect() {}, useRouter: () => ({ push: value => pushes.push(value) }) },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@/components/main/feature-guide-modal': { FeatureGuideModal: 'FeatureGuideModal' },
    '@/components/ui/grid-background': { GridBackground: 'GridBackground' },
    '@/components/ui/offset-card': { OffsetCard: 'OffsetCard' },
    '@/components/ui/user-avatar': { UserAvatar: 'UserAvatar' },
    '@/components/ui/tab-header-typography': typography,
    '@/lib/friends-api': {
      getCachedInsights: () => gate === 'ok' ? { ok: true, insights } : { ok: false, error: gate },
      getCachedPairing: () => paired ? { paired: true, relationship: 'Family', pairedDays: 12, partner: { userId: 'partner', displayName: 'Person' } } : { paired: false },
    },
    '@/lib/haptics': { haptics: { pageOpen: () => feedback.push('light') } },
    '@/lib/icons': { ICONS: { connect1: 1, connect2: 2, connect3: 3, connect4: 4, history: 5 } },
    '@/lib/me-stats': {}, '@/lib/onboarding': {}, '@/lib/pairing-realtime': {},
    '@/lib/subscription': { getCachedSubscriptionTier: () => tier }, '@/lib/supabase': {},
    '@/lib/use-subscription-tier': { useSubscriptionTier: () => tier },
  });
  const tree = Screen();
  return { tree, pushes, feedback, typography };
}
for (const platform of ['ios', 'android']) {
  test(`${platform}: Free restores four readable presets without blur or unlock overlays`, () => {
    const h = setup(platform);
    const all = nodes(h.tree);
    const locks = all.filter(n => n.props.accessibilityLabel === 'Join Plus to Unlock');
    assert.equal(locks.length, 0);
    assert.equal(texts(h.tree).includes('Join Plus to Unlock'), false);
    assert.equal(texts(h.tree).includes('Private paid insight'), false);
    assert.equal(all.some(n => n.props.blurRadius > 0 || n.type === 'Filter' || n.type === 'SvgText'), false);
    const presets = [
      'Important moments, changes, and quiet wins worth following up on will appear here.',
      'Get a clearer feel for their recent vibe and what’s been capturing their attention.',
      'Find thoughtful ways to check in, start a conversation, or spend time together.',
      'See the funny, cozy, or chaotic little patterns unfolding between your lives.',
    ];
    presets.forEach(preset => {
      const text = all.find(n => n.type === 'Text' && n.props.children === preset);
      assert.ok(text, 'preserve the full original default text');
      assert.equal(flatten(text.props.style).color, '#2A2118');
      assert.equal(flatten(text.props.style).textShadowRadius, undefined);
      const card = all.find(n => n.type === 'View' && n.props.children?.includes?.(text));
      assert.ok(card);
      assert.equal(card.props.accessibilityElementsHidden, undefined);
      assert.equal(card.props.onPress, undefined, 'no invisible unlock target remains');
      assert.equal(nodes(card).filter(n => n.type === 'Image').length, 1);
    });
    const originalBanner = all.find(n => n.type === 'Pressable' && texts(n).includes('Unlock your Connection details'));
    assert.ok(originalBanner, 'keep the original Plus entry and entitlement gate');
    originalBanner.props.onPress();
    assert.deepEqual(h.pushes, ['/(main)/(modals)/subscription-paywall']);
    assert.equal(h.feedback.length, 1);
  });
  test(`${platform}: Plus stays readable and ignores an old cached Free gate`, () => {
    const paid = setup(platform, { tier: 'pro' });
    assert.ok(texts(paid.tree).includes('Private paid insight'));
    assert.equal(nodes(paid.tree).some(n => n.props.accessibilityLabel === 'Join Plus to Unlock'), false);
    const empty = setup(platform, { tier: 'pro', content: false });
    assert.equal(nodes(empty.tree).filter(n => n.type === 'Image' && [1, 2, 3, 4].includes(n.props.source) && !n.props.blurRadius).length, 4);
    assert.equal(nodes(empty.tree).some(n => flatten(n.props.style).textShadowRadius), false);
    assert.equal(nodes(empty.tree).some(n => n.type === 'Filter'), false);
    const upgraded = setup(platform, { tier: 'pro', gate: 'plus_required' });
    assert.equal(nodes(upgraded.tree).filter(n => n.props.accessibilityLabel === 'Join Plus to Unlock').length, 0);
    const denied = setup(platform, { tier: 'free', gate: 'plus_required' });
    assert.equal(nodes(denied.tree).filter(n => n.props.accessibilityLabel === 'Join Plus to Unlock').length, 0);
    assert.equal(texts(denied.tree).includes('Private paid insight'), false);
  });
  test(`${platform}: unpaired users keep original pairing explanation`, () => {
    const h = setup(platform, { paired: false });
    assert.equal(nodes(h.tree).some(n => n.props.accessibilityLabel === 'Join Plus to Unlock'), false);
    assert.ok(texts(h.tree).includes('Catch what you missed'));
  });
}
test('Android header remains 20/26 and subtitle 12/18 even on narrow screens', () => {
  for (const width of [320, 360, 390, 430]) {
    const h = setup('android', { width });
    const all = nodes(h.tree);
    const title = all.find(n => n.type === 'Text' && n.props.children === 'Connection Board');
    const subtitle = all.find(n => n.type === 'Text' && n.props.children === 'The little things tell a bigger story.');
    assert.equal(flatten(title.props.style).fontSize, 20);
    assert.equal(flatten(title.props.style).lineHeight, 26);
    assert.equal(title.props.adjustsFontSizeToFit, false);
    assert.equal(title.props.numberOfLines, undefined);
    assert.equal(flatten(subtitle.props.style).fontSize, 12);
    assert.equal(flatten(subtitle.props.style).lineHeight, 18);
    assert.equal(subtitle.props.numberOfLines, undefined);
  }
});
test('iOS Connection title and subtitle use the shared tab header dimensions', () => {
  for (const width of [360, 390]) {
    const all = nodes(setup('ios', { width }).tree);
    const title = all.find(n => n.type === 'Text' && n.props.children === 'Connection Board');
    const subtitle = all.find(n => n.type === 'Text' && n.props.children === 'The little things tell a bigger story.');
    assert.equal(flatten(title.props.style).fontSize, 27);
    assert.equal(flatten(title.props.style).lineHeight, 33);
    assert.equal(title.props.adjustsFontSizeToFit, true);
    assert.equal(flatten(subtitle.props.style).fontSize, 13.5);
    assert.equal(flatten(subtitle.props.style).lineHeight, 19);
  }
});
test('Memories and both Quests states consume the shared header typography', () => {
  const read = name => fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/(tabs)', name), 'utf8');
  const bags = read('bags.tsx'), quests = read('quests.tsx');
  assert.match(bags, /title: \{[^\n]+\.\.\.tabHeaderTypography.title/);
  assert.match(bags, /Items with memories saved here\./);
  assert.match(bags, /subtitle: \{[\s\S]*\.\.\.tabHeaderTypography.subtitle/);
  assert.match(bags, /titleWrap: \{ flex: 1, paddingLeft: 8 \}/);
  assert.match(bags, /adjustsFontSizeToFit=\{Platform.OS !== 'android'\}/);
  assert.doesNotMatch(bags, /source=\{ICONS\.memory\}/);
  assert.match(quests, /title: \{[^\n]+\.\.\.tabHeaderTypography.title/);
  assert.match(quests, /subtitle: \{[^\n]+\.\.\.tabHeaderTypography.subtitle/);
  assert.equal((quests.match(/Weekly Goal/g) || []).length, 2);
  assert.equal((quests.match(/One goal, broken into daily small steps\./g) || []).length, 2);
  assert.doesNotMatch(quests, /Weekly To-Do List|Select your main goal of the week/);
});
