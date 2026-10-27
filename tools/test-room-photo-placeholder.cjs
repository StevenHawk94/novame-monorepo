const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./lifecycle-test-utils.cjs');
const art = load('apps/mobile/src/lib/room-photo-placeholder-art.ts');
const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];

test('empty frame and toy art is local cream camera decoration, without labels or remote images', () => {
  for (const kind of ['frame', 'doll']) {
    const xml = art.roomPhotoPlaceholderSvg(kind);
    assert.match(xml, /fill="#FFF2DC"/);
    assert.match(xml, /stroke="#A77B59"/);
    assert.match(xml, /stroke-dasharray=/);
    assert.doesNotMatch(xml, /<text|<image|href=|<animate/);
  }
  assert.match(art.roomPhotoPlaceholderSvg('frame'), /viewBox="0 0 100 144"/);
  assert.match(art.roomPhotoPlaceholderSvg('doll'), /viewBox="0 0 100 100"/);
});

test('decoration has no touch target and leaves the parent photo interaction unchanged', () => {
  const { RoomPhotoPlaceholder } = load('apps/mobile/src/components/burrow/room-photo-placeholder.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: x => x } },
    'react-native-svg': { SvgXml: 'SvgXml' }, '@/lib/room-photo-placeholder-art': art,
  });
  for (const kind of ['frame', 'doll']) {
    const tree = RoomPhotoPlaceholder({ kind });
    assert.equal(tree.props.pointerEvents, 'none');
    assert.equal(tree.props.accessible, false);
    for (const node of nodes(tree)) {
      assert.equal(node.props.onPress, undefined);
      assert.equal(node.props.onTouchStart, undefined);
    }
    assert.equal(tree.props.children.props.xml, art.roomPhotoPlaceholderSvg(kind));
  }
});

test('opened toy collection keeps the original empty face and each saved toy photo', () => {
  const { ToyPortrait } = load('apps/mobile/src/components/burrow/toy-portrait.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', StyleSheet: { create: x => x, absoluteFillObject: {} } },
    '@/lib/burrow-art-assets': { burrowArtForItem: () => ({ source: 1, width: 500, height: 500, bounds: [0, 0, 500, 500] }) },
    '@/lib/burrow-doll-face': { dollFaceRect: () => ({ left: '30%', top: '20%', width: '40%', height: '40%' }) },
    ...require('./burrow-attention-test-mocks.cjs'),
    './burrow-image': { Image: 'Image' }, './room-photo': { RoomPhoto: 'Photo' },
    './room-photo-placeholder': { RoomPhotoPlaceholder: 'Placeholder' },
  });
  const props = { item: { stable_id: 'toy-B' }, width: 100, height: 150 };
  let tree = nodes(ToyPortrait(props));
  assert.equal(tree.some(n => n.type === 'Placeholder'), false);
  assert.equal(tree.some(n => n.type === 'Photo'), false);
  tree = nodes(ToyPortrait({ ...props, photo: { id: 'photo-B', toyId: 'toy-B' } }));
  assert.equal(tree.some(n => n.type === 'Placeholder'), false);
  assert.equal(tree.find(n => n.type === 'PlushieFaceMask').props.photo.toyId, 'toy-B');
});

test('opened toy/editor never show room decoration; rooms opt in without changing photo loading', () => {
  const toy = fs.readFileSync('apps/mobile/src/components/burrow/localized-toy.tsx', 'utf8');
  assert.ok(!toy.includes('RoomPhotoPlaceholder'));
  assert.match(toy,/if\s*\(\s*!costume\s*\|\|\s*\(\s*photo\s*&&\s*!face\s*\)\s*\)\s*return\s*;/);
  const photo = fs.readFileSync('apps/mobile/src/components/burrow/room-photo.tsx', 'utf8');
  assert.ok(!photo.includes('RoomPhotoPlaceholder'));
  const native = fs.readFileSync('apps/mobile/src/components/burrow/interactive-doll.tsx', 'utf8');
  assert.match(native,/showEmptyPhotoDecoration\s*=\s*false/);
  const home=fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx','utf8');
  assert.match(home,/<DollPhotoPreview asset=\{dollArt\} photo=\{doll\}/);
  assert.doesNotMatch(home,/InteractiveDoll/,'Home shows static room decoration only');
  const staticToy=fs.readFileSync('apps/mobile/src/components/burrow/doll-photo-preview.tsx','utf8');
  assert.match(staticToy,/<PlushieFaceMask asset=\{asset\} photo=\{photo\} placeholder/);
  assert.ok(fs.readFileSync('apps/mobile/src/components/burrow/room-scene-art.tsx','utf8').includes('disabled={busy} showEmptyPhotoDecoration'));
  assert.ok(!fs.readFileSync('apps/mobile/src/components/burrow/photo-frame-sheet.tsx', 'utf8').includes('RoomPhotoPlaceholder'));
  const interaction = fs.readFileSync('apps/mobile/app/(main)/room-interaction.tsx', 'utf8');
  assert.ok(interaction.includes('Add your babe’s face and give them a squeeze.'));
  assert.match(interaction,/!ownToy\|\|!toyPhoto\?<View[^>]*><DollPhotoPreview/,'empty faces use the existing camera placeholder, not a transparent live toy');
});

test('Rage Room pushes from right, follows horizontal edge-back and does not let battle capture that edge', () => {
  const layout = fs.readFileSync('apps/mobile/app/(main)/_layout.tsx', 'utf8');
  assert.match(layout,/<Stack.Screen name="tame-enemy" options=\{MAIN_CARD_OPTIONS\}/);
  const options=load('apps/mobile/src/lib/main-navigation-options.ts',{
    './page-edge-gesture':load('apps/mobile/src/lib/page-edge-gesture.ts'),
  }).MAIN_CARD_OPTIONS;
  assert.equal(options.presentation,'card');assert.equal(options.animation,'slide_from_right');
  assert.equal(options.gestureEnabled,true);assert.equal(options.gestureDirection,'horizontal');
  assert.equal(options.fullScreenGestureEnabled,false);assert.equal(options.gestureResponseDistance.end,24);
  assert.equal(options.animationMatchesGesture,true);
  const battle = fs.readFileSync('apps/mobile/src/components/tame-enemy/swipe-attack-layer.tsx', 'utf8');
  assert.ok(battle.includes('.hitSlop({ left: -24 })'));
});
