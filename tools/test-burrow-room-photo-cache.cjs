const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load,deferred,flush } = require('./lifecycle-test-utils.cjs');

function harness() {
  const values = new Map(), files = new Set(), corrupt = new Set();let validations=0;
  const directory = 'file:///private/documents/burrow-room-photos/';
  let epoch = 1, identity = () => {}, downloads = 0, signs = 0,badDownloads=false,dimensionGate=Promise.resolve();
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
    'react-native':{Image:{getSize:async uri=>{validations++;await dimensionGate;if(corrupt.has(uri)||badDownloads)throw Error('invalid_image');return{width:400,height:400};}}},
    'expo-file-system/legacy': fileSystem,
    './app-major-update-api': { fetchRoomPhoto: async () => { signs++; return 'https://private.invalid/signed-photo'; } },
    './session-lifecycle': { sessionEpoch: () => epoch, subscribeSessionIdentity: callback => { identity = callback; return () => {}; } },
    './storage': { storage: { getString: key => values.get(key), set: (key, value) => values.set(key, value) } },
    '../shared/storage/artifacts': { BURROW_ROOM_PHOTO_DIRECTORY: directory, waitForRoomPhotoCleanup: async () => {} },
    '../shared/storage/keys': { kBurrowRoomPhotoCache: { name: 'room-photo-cache' } },
  };
  const open = () => load('apps/mobile/src/lib/burrow-room-photo-cache.ts', modules);
  return { open, files, values, corrupt, validationGate:promise=>{dimensionGate=promise;},badDownloads:value=>{badDownloads=value;},get validations(){return validations;}, get downloads() { return downloads; }, get signs() { return signs; },
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

test('receipt adopts the durable local crop without a second file copy; dropping the pending key cannot delete the current photo',async()=>{
  const h=harness(),cache=h.open(),preview={id:'local-plushie-key',updatedAt:'local'},receipt={id:'cloud',updatedAt:'remote'};
  const uri=await cache.keepRoomPhotoPreview(preview,'data:image/jpeg;base64,anBlZw==');
  cache.adoptRoomPhotoPreview(receipt,preview);
  assert.equal(cache.cachedRoomPhotoUri(preview),null);assert.equal(cache.cachedRoomPhotoUri(receipt),uri);assert.ok(h.files.has(uri));
  assert.equal(await h.open().loadRoomPhoto(receipt),uri);assert.equal(h.signs,0);assert.equal(h.downloads,0);
});

test('a missing local intent is never requested from the private cloud-photo endpoint',async()=>{
  const h=harness();await assert.rejects(h.open().loadRoomPhoto({id:'local-plushie-key',updatedAt:'local'}),/photo_local_unavailable/);
  await assert.rejects(h.open().loadRoomPhoto({id:'local-frame-key',updatedAt:'local'}),/photo_local_unavailable/);
  assert.equal(h.signs,0);
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

test('shared private-file verification is single-flight and cached, without re-fetching healthy photos',async()=>{
 const h=harness(),cache=h.open(),photo={id:'healthy',updatedAt:'one'};
 const [a,b]=await Promise.all([cache.loadRoomPhoto(photo),cache.loadRoomPhoto(photo)]);
 assert.equal(a,b);await cache.loadRoomPhoto(photo);assert.equal(h.validations,1);assert.equal(h.downloads,1);
});

test('a corrupt persisted file is discarded and recovered without relying on SVG image events',async()=>{
 const h=harness(),photo={id:'svg-face',updatedAt:'one'},uri=await h.open().loadRoomPhoto(photo);
 h.corrupt.add(uri);const restarted=h.open(),recovered=await restarted.loadRoomPhoto(photo);
 assert.notEqual(recovered,uri);assert.equal(h.files.has(uri),false);assert.equal(h.downloads,2);
 assert.equal(restarted.cachedRoomPhotoUri(photo),recovered);
});

test('a corrupt download is not published or retained; a later retry can recover',async()=>{
 const h=harness(),cache=h.open(),photo={id:'broken',updatedAt:'one'};h.badDownloads(true);
 await assert.rejects(cache.loadRoomPhoto(photo),/invalid_image/);
 assert.equal(cache.cachedRoomPhotoUri(photo),null);assert.equal(h.files.size,0);
 h.badDownloads(false);assert.ok(await cache.loadRoomPhoto(photo));assert.equal(h.downloads,2);
});

test('switching accounts during native file verification cannot publish the old private photo',async()=>{
 const h=harness(),cache=h.open(),photo={id:'private',updatedAt:'one'},gate=deferred();h.validationGate(gate.promise);
 const request=cache.loadRoomPhoto(photo);await flush();assert.equal(h.validations,1);
 h.changeAccount();gate.resolve();await assert.rejects(request,/session_changed/);
 assert.equal(cache.cachedRoomPhotoUri(photo),null);assert.equal(h.files.size,0);
});
