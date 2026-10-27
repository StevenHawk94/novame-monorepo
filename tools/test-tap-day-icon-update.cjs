const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./lifecycle-test-utils.cjs');
const root = path.resolve(__dirname, '..');
const layout = load('apps/mobile/src/lib/tap-day-icon-layout.ts');
const jsx = (type, props) => ({ type, props });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const nodes = tree => !tree || typeof tree !== 'object' ? []
  : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];

test('selection, optional activity and preview art shrink once by 30%, preserving aspect ratio', () => {
  const { TapDayIcon } = load('apps/mobile/src/components/ui/tap-day-icon.tsx', {
    'expo-image': { Image: 'Image' }, 'react-native': { Platform: { OS: 'ios' } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/tap-day-images.g': { TAP_DAY_IMAGES: { 'sample': 'local-new-art' } },
    '@/lib/tap-day-icon-layout': layout,
  });
  for (const [size, expected] of [[58, 40.6], [54, 37.8], [44, 30.8]]) {
    const image = TapDayIcon({ itemId: 'sample', size, radius: 10 });
    close(image.props.style.width, expected);
    close(image.props.style.height, expected);
    close(image.props.style.borderRadius, 7);
    assert.equal(image.props.contentFit, 'contain');
    assert.equal(image.props.transition, 0);
    assert.equal(image.props.source, 'local-new-art');
  }
});

test('selection border follows smaller art without shrinking twice; labels, columns and selection remain intact', () => {
  const { TapYourDayItem, tapItemGridMetrics } = load('apps/mobile/src/components/main/tap-your-day-item.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', View: 'View', Text: 'Text', StyleSheet: { create: v => v } },
    '@expo/vector-icons': { MaterialIcons: 'MaterialIcons' },
    '@/components/ui/tap-day-icon': { TapDayIcon: 'TapDayIcon' },
    '@/lib/tap-day-icon-layout': layout,
  });
  const choice = { itemId: 'sample', label: 'Same selection label' };
  let presses = 0;
  const tree = TapYourDayItem({ choice, width: 76, selected: true, onPress: () => presses++ });
  const all = nodes(tree), image = all.find(n => n.type === 'TapDayIcon');
  assert.equal(image.props.size, 58); // Leaf applies 0.7, not 0.7 squared.
  const frame = all.find(n => n.type === 'View' && n.props.style?.[1]?.width);
  close(frame.props.style[1].width, 46.6);
  assert.equal(all.find(n => n.type === 'Text').props.children, choice.label);
  assert.equal(tree.props.style[1].width, 76);
  assert.equal(tree.props.accessibilityState.checked, true);
  tree.props.onPress(); assert.equal(presses, 1);
  assert.equal(tapItemGridMetrics(390).columns, 4);
  const preview = TapYourDayItem({ choice, width: 50, iconSize: 44, showLabel: false });
  const previewNodes = nodes(preview);
  assert.equal(previewNodes.find(n => n.type === 'TapDayIcon').props.size, 44);
  close(previewNodes.find(n => n.type === 'View' && n.props.style?.[1]?.height).props.style[1].width, 36.8);
  assert.equal(previewNodes.filter(n => n.type === 'Text').length, 0);
});

test('all 391 current selections share the same local art in Tap Your Day and Moments', () => {
  const readMap = file => new Map([...fs.readFileSync(path.join(root, file), 'utf8')
    .matchAll(/'([^']+)': require\('([^']+\.webp)'\)/g)].map(([, id, asset]) => [id, asset]));
  const tap = readMap('apps/mobile/src/lib/tap-day-images.g.ts');
  const base = readMap('apps/mobile/src/lib/item-images.g.ts');
  const people = readMap('apps/mobile/src/lib/tap-person-images.ts');
  assert.equal(tap.size, 391);
  for (const [id, asset] of tap) {
    assert.equal(base.get(id) ?? people.get(id), asset, id);
    assert.ok(fs.existsSync(path.resolve(root, 'apps/mobile/src/lib', asset)), id);
  }
  for (const [id, filename] of [['memory.1491_restaurant', 'memory.1491_restaurant.webp'],
    ['memory.new_ice_cream', 'memory.0455_ice_cream.webp'], ['memory.new_beer', 'memory.0557_beer.webp']]) {
    assert.equal(tap.get(id), '../../assets/Tap-your-day-Icons/' + filename);
  }
  const sprite = fs.readFileSync(path.join(root, 'apps/mobile/src/components/ui/item-sprite.tsx'), 'utf8');
  assert.doesNotMatch(sprite, /tap-day-icon-layout|tapDayIconSize/); // Moments sizes are unchanged.
});
