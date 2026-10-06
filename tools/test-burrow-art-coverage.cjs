const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./lifecycle-test-utils.cjs');
const registry = 'apps/mobile/src/lib/burrow-art-assets.ts';
const source = fs.readFileSync(registry, 'utf8');
const imports = Object.fromEntries([...source.matchAll(/require\((['"])(.*?)\1\)/g)]
  .map(match => [match[2], path.resolve(path.dirname(registry), match[2])]));
const { BURROW_ART, burrowArtForItem } = load(registry, imports);
const { HOME_ART_PLACEMENTS } = load('apps/mobile/src/lib/burrow-home-layout.ts');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});

test('every supplied WebP has a bundled reference, without requiring deleted PNGs', () => {
  const code = [...walk('apps/mobile/src'), ...walk('apps/mobile/app')]
    .filter(file => /\.[jt]sx?$/.test(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  for (const file of walk('apps/mobile/assets/burrow-webp').filter(file => file.endsWith('.webp'))) {
    assert.ok(code.includes(file.replace('apps/mobile/assets/', '')), `unmapped WebP: ${file}`);
  }
  for (const file of Object.values(imports)) assert.ok(fs.existsSync(file), file);
});

test('all room slots retain art with old cached categories or invalid ordinals', () => {
  for (const placement of [...HOME_ART_PLACEMENTS,
    { category: 'frames' }, { category: 'couple_dolls' }, { category: 'wallpapers' }]) {
    const fallback = BURROW_ART[placement.category][0];
    assert.ok(fallback);
    assert.equal(burrowArtForItem(undefined, placement.category), fallback);
    assert.equal(burrowArtForItem({ category: 'old_category', metadata: { starter: true } }, placement.category), fallback);
    assert.equal(burrowArtForItem({ category: placement.category, metadata: { artOrdinal: 9999 } }, placement.category), fallback);
    const variants = BURROW_ART[placement.category];
    for (let index = 0; index < variants.length; index++) {
      assert.equal(burrowArtForItem({ category: placement.category, metadata: { artOrdinal: index + 1 } }), variants[index]);
    }
  }
});

test('Burrow artwork uses the standard WebP decoder and Home opens Affection', () => {
  const image = fs.readFileSync('apps/mobile/src/components/burrow/burrow-image.tsx', 'utf8');
  assert.ok(image.includes('useAppleWebpCodec={false}'));
  for (const file of ['home-art-scene', 'burrow-shop', 'interactive-doll', 'burrow-map']) {
    assert.ok(fs.readFileSync(`apps/mobile/src/components/burrow/${file}.tsx`, 'utf8').includes("from './burrow-image'"));
  }
  const home = fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx', 'utf8');
  assert.ok(home.includes('onPress={onAffection}'));
  assert.ok(home.includes('>Affection</Text>'));
  assert.ok(!home.includes('onQuests'));
});
