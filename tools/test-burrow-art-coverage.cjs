const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
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

test('supplied WebPs are bundled room art or registered R2-only adventure gifts, without deleted PNG references', () => {
  const code = [...walk('apps/mobile/src'), ...walk('apps/mobile/app')]
    .filter(file => /\.[jt]sx?$/.test(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  // Adventure gifts intentionally moved to R2; bundling them would inflate
  // the app and contradict the remote-only reward/prefetch contract.
  const remoteGifts = new Set(walk('apps/api/src/data/adventure-friends').filter(file=>file.endsWith('.json'))
    .flatMap(file=>JSON.parse(fs.readFileSync(file,'utf8')).gifts)
    .filter(gift=>gift.key.startsWith('burrow/adventure-gifts/v1/')&&gift.sha256)
    .map(gift=>path.join('apps/mobile/assets/burrow-webp/Gift Collection Webp',gift.file)));
  for (const file of walk('apps/mobile/assets/burrow-webp').filter(file => file.endsWith('.webp'))) {
    if (remoteGifts.has(file)) {
      assert.ok(!code.includes(file.replace('apps/mobile/assets/', '')), `R2 gift must not be bundled: ${file}`);
      continue;
    }
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
  assert.ok(home.includes('onPress={pull.guard(onAffection)}'));
  assert.ok(home.includes('>Affection</Text>'));
  assert.ok(!home.includes('onQuests'));
});

test('Home and its offline preview use the current layered bunny, never retired flattened artwork', () => {
  const home = fs.readFileSync('apps/mobile/src/components/burrow/home-art-scene.tsx', 'utf8');
  const renderer = fs.readFileSync('apps/mobile/src/components/burrow/outfit-bunny.tsx', 'utf8');
  assert.match(home, /<OutfitBunny outfit=\{slots.outfit\}/);
  assert.match(renderer, /BUNNY_RIG\.drawOrderBottomToTop\.map/);
  assert.match(renderer, /source=\{layers\[layer as keyof typeof layers\]/);
  const preview = fs.readFileSync('tools/preview-burrow-home.cjs', 'utf8');
  assert.doesNotMatch(preview, /home-bunny\.webp|BURROW_FIXED_ART\.bunny|HOME_BUNNY_PLACEMENT/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novame-layered-home-preview-'));
  const output = path.join(directory, 'home.png');
  try {
    const result = spawnSync(process.execPath, ['tools/preview-burrow-home.cjs', output], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
    const png = fs.readFileSync(output);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 900); assert.equal(png.readUInt32BE(20), 1950);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
