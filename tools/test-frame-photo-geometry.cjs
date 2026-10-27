const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, hooks, deferred, flush } = require('./lifecycle-test-utils.cjs');
const crop = load('apps/mobile/src/lib/room-photo-crop.ts');
const registryFile = 'apps/mobile/src/lib/burrow-art-assets.ts';
const imports = Object.fromEntries([...fs.readFileSync(registryFile, 'utf8').matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(m => [m[2], path.resolve(path.dirname(registryFile), m[2])]));
const art = load(registryFile, imports);
const { framePhotoRect } = load('apps/mobile/src/lib/burrow-doll-face.ts', { './burrow-art-assets': art, './room-photo-crop': crop });
const layout = load('apps/mobile/src/lib/burrow-home-layout.ts');

test('all ten frame variants have identical 201:290 photo sizes and positions in Home/preview', () => {
  assert.equal(art.BURROW_ART.frames.length, 10);
  for (const scale of [.35, .5, 1]) {
    let baseline;
    for (const frame of art.BURROW_ART.frames) {
      assert.equal(frame.width, 500);
      assert.equal(frame.height, 500);
      assert.deepEqual(Array.from(frame.photoBounds), [150, 128, 351, 418]);
      const box = layout.homeAnchoredBox(frame, layout.HOME_FRAME_PLACEMENT, scale);
      const inset = framePhotoRect(frame);
      const photo = {
        left: box.left + parseFloat(inset.left) / 100 * box.width,
        top: box.top + parseFloat(inset.top) / 100 * box.height,
        width: parseFloat(inset.width) / 100 * box.width,
        height: parseFloat(inset.height) / 100 * box.height,
      };
      baseline ??= photo;
      assert.deepEqual(photo, baseline);
      assert.ok(Math.abs(photo.width / photo.height - crop.FRAME_PHOTO_ASPECT) < 1e-10);
    }
  }
});

test('Shop and Collection thumbnails use the same frame envelope', () => {
  for (const file of ['burrow-shop', 'burrow-screen']) {
    assert.match(fs.readFileSync(`apps/mobile/src/components/burrow/${file}.tsx`, 'utf8'), /item.category\s*===\s*'frames'\s*\?\s*FRAME_ART_REFERENCE_BOUNDS\s*:\s*asset.bounds/);
  }
  assert.deepEqual(Array.from(crop.FRAME_ART_REFERENCE_BOUNDS), Array.from(art.BURROW_ART.frames[0].bounds));
});

const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
test('crop viewport and saved-photo preview use the same ratio without inset borders', () => {
  const hook = hooks();
  let handler;
  const { FramePhotoCropper } = load('apps/mobile/src/components/burrow/frame-photo-cropper.tsx', {
    react: hook.react, 'react/jsx-runtime': { jsx, jsxs: jsx }, './burrow-image': { Image: 'Image' },
    '@/lib/room-photo-crop': crop,
    'react-native': { Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View',
      useWindowDimensions: () => ({ width: 390, height: 844 }), StyleSheet: { create: x => x },
      PanResponder: { create: input => { handler = input; return { panHandlers: { gesture: true } }; } } },
  });
  const render = () => hook.render(() => FramePhotoCropper({ asset: { uri: 'fixture', width: 1200, height: 800 }, onCancel() {}, onConfirm: async () => {} }));
  const viewport = nodes(render()).find(n => n.props?.gesture);
  const style = Object.assign({}, ...viewport.props.style);
  assert.equal(style.borderWidth, undefined);
  assert.ok(Math.abs(style.width / style.height - crop.FRAME_PHOTO_ASPECT) < 1e-10);
  handler.onPanResponderGrant();
  handler.onPanResponderMove(null, { dx: 30, dy: 15 });
  const moved = nodes(render()).find(n => n.props?.gesture).props.children.props.style;
  const geometry = crop.positionedFrameCrop(1200, 800, style.width, 1, 30, 15);
  assert.ok(Math.abs(-moved.left / geometry.scale - geometry.crop.originX) < 1e-8);
  assert.ok(Math.abs(-moved.top / geometry.scale - geometry.crop.originY) < 1e-8);
  assert.equal(crop.FRAME_PHOTO_OUTPUT_SIZE.width * 290, crop.FRAME_PHOTO_OUTPUT_SIZE.height * 201);
});

test('frame crop confirmation has no cloud Saving state and same-frame taps enqueue only once; local failure permits retry',async()=>{
  const hook=hooks(),pending=deferred();let calls=0;
  const {FramePhotoCropper}=load('apps/mobile/src/components/burrow/frame-photo-cropper.tsx',{
    react:hook.react,'react/jsx-runtime':{jsx,jsxs:jsx},'./burrow-image':{Image:'Image'},'@/lib/room-photo-crop':crop,
    'react-native':{Modal:'Modal',Pressable:'Pressable',Text:'Text',View:'View',useWindowDimensions:()=>({width:390,height:844}),
      StyleSheet:{create:x=>x},PanResponder:{create:()=>({panHandlers:{}})}},
  });
  const render=()=>hook.render(()=>FramePhotoCropper({asset:{uri:'fixture',width:1200,height:800},onCancel(){},onConfirm:()=>{calls++;return pending.promise;}}));
  const button=nodes(render()).find(n=>n.type==='Pressable'&&n.props.children?.props?.children==='Use This Crop');
  button.props.onPress();button.props.onPress();assert.equal(calls,1);
  assert.equal(nodes(render()).some(n=>n.props?.children==='Saving…'),false);
  pending.reject(Error('disk_full'));await flush();
  const retry=nodes(render()).find(n=>n.type==='Pressable'&&n.props.children?.props?.children==='Use This Crop');
  assert.equal(retry.props.disabled,false);retry.props.onPress();await flush();assert.equal(calls,2);hook.unmount();
});
