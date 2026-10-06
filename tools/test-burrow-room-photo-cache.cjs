const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

function harness() {
  const values = new Map(), files = new Set();
  const directory = 'file:///private/documents/burrow-room-photos/';
  let epoch = 1, identity = () => {}, downloads = 0, signs = 0;
  const fileSystem = {
    EncodingType: { Base64: 'base64' },
    writeAsStringAsync: async (uri, bytes, options) => { assert.equal(options.encoding, 'base64'); assert.ok(bytes); files.add(uri); },
    makeDirectoryAsync: async () => {},
    deleteAsync: async uri => { files.delete(uri); },
    copyAsync: async ({ from, to }) => { assert.ok(files.has(from)); files.add(to); },
    moveAsync: async ({ from, to }) => { assert.ok(files.has(from)); files.delete(from); files.add(to); },
    getInfoAsync: async uri => ({ exists: files.has(uri) }),
    downloadAsync: async (_url, uri) => { downloads++; files.add(uri); return { status: 200 }; },
  };
  const modules = {
    'expo-file-system/legacy': fileSystem,
    './app-major-update-api': { fetchRoomPhoto: async () => { signs++; return 'https://private.invalid/signed-photo'; } },
    './session-lifecycle': { sessionEpoch: () => epoch, subscribeSessionIdentity: callback => { identity = callback; return () => {}; } },
    './storage': { storage: { getString: key => values.get(key), set: (key, value) => values.set(key, value) } },
    '../shared/storage/artifacts': { BURROW_ROOM_PHOTO_DIRECTORY: directory, waitForRoomPhotoCleanup: async () => {} },
    '../shared/storage/keys': { kBurrowRoomPhotoCache: { name: 'room-photo-cache' } },
  };
  const open = () => load('apps/mobile/src/lib/burrow-room-photo-cache.ts', modules);
  return { open, files, values, get downloads() { return downloads; }, get signs() { return signs; },
    changeAccount() { epoch++; values.clear(); files.clear(); identity(); } };
}

test('frame/Toy photo saves a private document and appears synchronously after module restart', async () => {
  const h = harness();
  const first = h.open(), photo = { id: 'frame-1', updatedAt: '2026-10-02T10:00:00Z' };
  h.files.add('file:///temporary/cropped.jpg');
  const uri = await first.keepRoomPhotoPreview(photo, 'file:///temporary/cropped.jpg');
  assert.match(uri, /burrow-room-photos\/.*\.jpg$/);
  assert.equal(first.cachedRoomPhotoUri(photo), uri);
  const restarted = h.open();
  assert.equal(restarted.cachedRoomPhotoUri(photo), uri);
  assert.equal(await restarted.loadRoomPhoto(photo), uri);
  assert.equal(h.signs, 0, 'a persisted crop never needs a fresh signed link');
  assert.equal(h.downloads, 0);
});

test('a changed photo version downloads once, then survives restart without the expiring link', async () => {
  const h = harness(), first = h.open();
  const before = { id: 'toy-1', updatedAt: 'old' }, after = { id: 'toy-1', updatedAt: 'new' };
  const original = await first.loadRoomPhoto(before);
  const updated = await first.loadRoomPhoto(after);
  assert.notEqual(updated, original);
  assert.equal(h.signs, 2);
  assert.equal(h.files.has(original), false, 'the superseded version is pruned');
  const restarted = h.open();
  assert.equal(restarted.cachedRoomPhotoUri(after), updated);
  assert.equal(await restarted.loadRoomPhoto(after), updated);
  assert.equal(h.signs, 2);
});

test('a recovered base64 draft becomes a private durable file without another upload/download', async () => {
  const h = harness(), cache = h.open(), photo = { id: 'recovered', updatedAt: 'now' };
  const uri = await cache.keepRoomPhotoPreview(photo, 'data:image/jpeg;base64,anBlZw==');
  assert.ok(h.files.has(uri)); assert.equal(h.open().cachedRoomPhotoUri(photo), uri);
  assert.equal(h.signs, 0); assert.equal(h.downloads, 0);
});

test('a missing file is re-fetched; account change clears every private photo lookup', async () => {
  const h = harness(), cache = h.open(), photo = { id: 'frame-2', updatedAt: 'today' };
  const uri = await cache.loadRoomPhoto(photo);
  h.files.delete(uri);
  assert.notEqual(await cache.loadRoomPhoto(photo), uri);
  assert.equal(h.downloads, 2);
  h.changeAccount();
  assert.equal(cache.cachedRoomPhotoUri(photo), null);
  assert.equal(h.open().cachedRoomPhotoUri(photo), null);
});
