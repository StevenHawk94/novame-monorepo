const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./lifecycle-test-utils.cjs');
const { normalizeMetroAssetUri } = load('apps/mobile/src/lib/metro-asset-uri.ts', {}, { URL, URLSearchParams });

test('Metro nested double-encoded paths resolve with spaces and secondary query intact', () => {
  const broken = 'http://localhost:8081/assets/?unstable_path=.%252Fassets%252Fburrow-webp%252Froom%2520decoration%252Fwindows/Default-Autumn%20Sunset.webp?platform=ios&hash=abc';
  const url = new URL(normalizeMetroAssetUri(broken));
  assert.equal(url.pathname, '/assets/assets/burrow-webp/room%20decoration/windows/Default-Autumn%20Sunset.webp');
  assert.equal(url.searchParams.get('platform'), 'ios');
  assert.equal(url.searchParams.get('hash'), 'abc');
  assert.equal(url.searchParams.has('unstable_path'), false);
});

test('all bundled art paths survive Metro URI normalization without renaming assets', () => {
  const registry = fs.readFileSync('apps/mobile/src/lib/burrow-art-assets.ts', 'utf8');
  for (const [, , relative] of registry.matchAll(/require\((['"])(.*?)\1\)/g)) {
    const file = relative.replace('../../', '');
    const slash = file.lastIndexOf('/');
    const directory = './' + file.slice(0, slash);
    const broken = `http://localhost:8081/assets/?unstable_path=${encodeURIComponent(encodeURIComponent(directory))}/${encodeURIComponent(file.slice(slash + 1))}?platform=ios&hash=test`;
    const fixed = new URL(normalizeMetroAssetUri(broken));
    assert.equal(decodeURIComponent(fixed.pathname), '/assets/' + file);
    assert.equal(fixed.searchParams.get('platform'), 'ios');
    assert.equal(normalizeMetroAssetUri(fixed.href), fixed.href);
  }
});

test('production, user photos, and unrelated URLs are untouched', () => {
  for (const uri of ['file:///documents/photo.webp', 'asset:/art.webp', 'https://storage.example.com/photo.webp?token=private', 'http://localhost:8081/assets/art.webp?platform=ios']) {
    assert.equal(normalizeMetroAssetUri(uri), uri);
  }
  const traversal = 'http://localhost:8081/assets/?unstable_path=..%252Fsecret.webp';
  assert.equal(normalizeMetroAssetUri(traversal), traversal);
});
