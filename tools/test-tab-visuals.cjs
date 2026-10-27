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
function setup(platform, { tier = 'free', paired = true, width = 390 } = {}) {
  let reads = 0;
  const { default: Screen } = load('apps/mobile/app/(main)/(tabs)/status.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { Redirect: 'Redirect' },
    '@/lib/friends-api': { getCachedInsights: () => { reads++; throw Error('retired insights must not load'); } },
    '@/lib/use-subscription-tier': { useSubscriptionTier: () => { reads++; return tier; } },
    '@/lib/use-major-update': { useMajorUpdateEnabled: () => paired },
  });
  return { tree: Screen(), reads: () => reads,
    typography: load('apps/mobile/src/components/ui/tab-header-typography.ts', { 'react-native': native(platform, width) }) };
}
for (const platform of ['ios', 'android']) {
  for (const [name, options] of [['Free', { tier: 'free' }], ['Plus', { tier: 'pro' }], ['unpaired', { paired: false }]]) {
    test(platform + ': retired Connection link returns ' + name + ' users Home without reading paid/private data', () => {
      const h = setup(platform, options);
      assert.equal(h.tree.type, 'Redirect');
      assert.equal(h.tree.props.href, '/(main)/(tabs)');
      assert.equal(h.reads(), 0);
    });
  }
}
test('Android shared tab typography remains 20/26 and 12/18 on narrow screens', () => {
  for (const width of [320, 360, 390, 430]) {
    const { title, subtitle } = setup('android', { width }).typography.tabHeaderTypography;
    assert.equal(title.fontSize, 20); assert.equal(title.lineHeight, 26);
    assert.equal(subtitle.fontSize, 12); assert.equal(subtitle.lineHeight, 18);
  }
});
test('iOS shared tab typography retains 27/33 and 13.5/19 without reviving the retired screen', () => {
  const { title, subtitle } = setup('ios').typography.tabHeaderTypography;
  assert.equal(title.fontSize, 27); assert.equal(title.lineHeight, 33);
  assert.equal(subtitle.fontSize, 13.5); assert.equal(subtitle.lineHeight, 19);
});
test('Memories typography and the product-action Quests board stay on-brand', () => {
  const read = name => fs.readFileSync(path.join(root, 'apps/mobile/app/(main)/(tabs)', name), 'utf8');
  const bags = read('bags.tsx'), quests = read('quests.tsx');
  assert.match(bags, /title: \{[^\n]+\.\.\.tabHeaderTypography.title/);
  assert.match(bags, /Items with memories saved here\./);
  assert.match(bags, /subtitle: \{[\s\S]*\.\.\.tabHeaderTypography.subtitle/);
  assert.match(bags, /titleWrap: \{ flex: 1, paddingLeft: 8 \}/);
  assert.match(bags, /adjustsFontSizeToFit=\{Platform.OS !== 'android'\}/);
  assert.doesNotMatch(bags, /source=\{ICONS\.memory\}/);
  assert.match(quests, /Daily Quests/);
  assert.match(quests, /Special Quests/);
  assert.match(quests, /headerTitle: \{ color: '#FFF9F0'.*fontSize: 27/);
  assert.match(quests, /GridBackground base=\{BG\} line=\{GRID\}/);
  assert.doesNotMatch(quests, /Weekly Goal|Weekly To-Do List|Select your main goal of the week/);
});

test('retired Paired background is not rendered or awaited on either platform', () => {
  const friends = fs.readFileSync(
    path.join(root, 'apps/mobile/app/(main)/(tabs)/friends.tsx'),
    'utf8',
  );
  assert.doesNotMatch(friends, /BACKGROUNDS\.friends|FRIENDS_BACKGROUND_WIDTH|androidBackgroundHeight|HomeEntryImage/);
  assert.match(friends,/markHomeEntryAsset\('friends-background',homeEntry\.attempt\)/);
  assert.match(friends,/root: \{ flex: 1, backgroundColor: '#6B4226' \}/);
});
