const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, hooks, deferred, flush, clock } = require('./lifecycle-test-utils.cjs');

const jsx = (type, props) => ({ type, props });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];

test('Toy shutter immediately shows processing feedback until the saved photo returns', async () => {
  const h = hooks(), picture = deferred(), timer = clock();
  let vibration = 0, saved = 0, closed = 0;
  const { RoomPhotoEditor } = load('apps/mobile/src/components/burrow/room-photo.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'ActivityIndicator', AppState: {}, Alert: { alert() {} }, Modal: 'Modal',
      PanResponder: { create: () => ({ panHandlers: {} }) }, Pressable: 'Pressable', ScrollView: 'ScrollView',
      StyleSheet: { create: value => value, absoluteFillObject: {} }, Text: 'Text', View: 'View',
      useWindowDimensions: () => ({ width: 390, height: 844 }) },
'./burrow-image': { Image: 'Image' }, 'expo-image': { Image: 'Image' }, 'expo-image-picker': {}, 'expo-router': { useFocusEffect() {} },
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })] },
    'expo-crypto': { randomUUID: () => 'photo-key' },
    'expo-image-manipulator': { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async () => ({ uri: 'processed', base64: 'jpeg-bytes' }) },
    '@/lib/app-major-update-api': { saveRoomPhoto: async () => ({ photoId: 'saved-photo', photo: { id: 'saved-photo', ownerId: 'me', kind: 'doll', updatedAt: '2026-10-05T12:00:00Z' } }) },
    '@/lib/burrow-room-photo-cache': { cachedRoomPhotoUri: () => null, loadRoomPhoto: async () => '', keepRoomPhotoPreview: async () => '', invalidateRoomPhotoCache() {} },
    '@/lib/burrow-store': { setBurrowPhotoLocally() {}, scheduleBurrowRefresh() {}, refreshBurrow: async () => {}, refreshBurrowAfterCurrent: async () => {}, getBurrowSnapshot: () => ({ data: { roomPhotos: [] } }) },
    '@/lib/burrow-photo-drafts': { readPhotoDraft: () => null, persistPhotoDraft() {}, removePhotoDraft() {} },
    '@/lib/burrow-doll-face': { dollFaceBounds: () => [100, 100, 300, 300], dollFaceRect: () => ({}) },
    '@/lib/room-photo-errors': load('apps/mobile/src/lib/room-photo-errors.ts'),
    '@/lib/room-photo-crop': load('apps/mobile/src/lib/room-photo-crop.ts'),
    '@/lib/haptics': { haptics: { medium: async () => { vibration++; } } },
    '@/lib/session-lifecycle': { sessionEpoch: () => 1, subscribeSessionIdentity: () => () => {} },
    './burrow-back-button': { BurrowBackButton: 'BurrowBackButton' },
    './frame-photo-cropper': { FramePhotoCropper: 'FramePhotoCropper' },
  }, timer.globals);
  const render = () => h.render(() => RoomPhotoEditor({ data: { profile: { id: 'me' }, roomPhotos: [] }, ownerId: 'me',
    kind: 'doll', toyAsset: { source: 1, width: 600, height: 600, bounds: [0, 0, 600, 600] },
    initialSource: 'camera', captureOnly: true, onSaved: () => saved++, onClose: () => closed++ }));
  let tree = render();
  nodes(tree).find(node => node.type === 'CameraView').props.ref.current = { takePictureAsync: () => picture.promise };
  nodes(tree).find(node => node.props?.accessibilityLabel === 'Take photo').props.onPress();
  tree = render();
  assert.equal(vibration, 1);
  assert.equal(nodes(tree).find(node => node.props?.accessibilityLabel === 'Take photo').props.disabled, true);
  assert.ok(nodes(tree).some(node => node.props?.children === 'Processing your photo…'));
  picture.resolve({ uri: 'captured', width: 600, height: 600 });
  await flush(); await flush();
  assert.equal(saved, 1); assert.equal(closed, 1);
});
