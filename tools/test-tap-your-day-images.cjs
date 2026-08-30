/* Run: node --test tools/test-tap-your-day-images.cjs. No native runtime or network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, imports = {}, assets = false) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (assets && name.endsWith('.webp')) return path.resolve(path.dirname(filename), name);
      throw new Error('Unexpected dependency: ' + name);
    },
  }, { filename });
  return module.exports;
}

const people = load('apps/mobile/src/lib/tap-person-images.ts', {}, true).TAP_PERSON_IMAGES;
const catalog = load('packages/engine/src/items/tap-your-day.ts', {
  './tap-your-day-v1.json': require('../packages/engine/src/items/tap-your-day-v1.json'),
});
const expected = [
  ['Learning', 'memory.3006_globe', '7b5a0ac3143be6b94133eb4c6806dcde7c8175c826a1b6729f9353151430d6ec'],
  ['Relaxing', 'memory.1421_bed', '72cf9801934934253f240e6a00c816611cbaf46649cda64f65f8bae427b14a9e'],
  ['Commuting', 'memory.2127_bus', '2c0ab502cb78c6c00bacda59011d3aaa53165e54223b5f82f3617b834ba901f2'],
  ['Noodles', 'memory.0718_rice_noodles', 'ae854ce88124acfcd21638b4a915a0e89111ce62d9ad4056e62104c291a1fa38'],
  ['Work', 'memory.1541_workplace', '5dd3d07d20e4dda69d891c05f4e55465c14d321c2d040a2aae0bcf368c9fe280'],
  ['Appointments', 'memory.1435_appointment_book', '9652b361c743712c6f64cf7103807e1f3f8dd2a0727bd49eb8eb281709915c19'],
  ['Yoga', 'memory.1304_yoga', '550d80e2dabb13691df63acff3394a701ec58309d3f5b520e9ffab052646082a'],
  ['Socializing', 'memory.1403_picnic', 'eff0819d0142b405919dcab720dc5d27efb25ca2e3feac41dd8330d3998918ce'],
  ['Date', 'memory.1491_restaurant', 'af134a0f3bae91c49bb621a5005e4d9de190c55fede2de3e45025a3e2d291fa9'],
  ['Events', 'memory.2261_event_ticket', '0ad2d89f02aa7737ebe2be2a24af92091daa2b12faa22dd68dbbd54f4cfa759a'],
  ['Volunteering', 'memory.1594_volunteer_center', '9c569bb892edccd9b5940925256ba646809f87214ca0130da22d39b110c7cd80'],
  ['Movies', 'memory.1363_movie_theater', '2023378e8a60c6e8d94362a18f32ce56f537b181856b0d500f658107618b448a'],
  ['TV', 'memory.1362_television', '70ae1e0ffc4c7627306e0335f8bcd56401060f7af20cbe260042071b4bdd8a14'],
  ['Social Media', 'memory.5385_social_media', '37af815184079c41f16b7f53f4c76fb0a96be0b8092e3e08d6d85dffe809d7f0'],
  ['Writing', 'memory.2876_notebook', '78abbe436fedca3961cbb764088a657c23e5fa38aebb79f470cb8cf54bea0b89'],
];

test('all 15 approved Tap Your Day artworks are now the canonical item files', () => {
  assert.equal(catalog.TAP_YOUR_DAY_CHOICES.length, 131);
  assert.equal(catalog.TAP_YOUR_DAY_VERSION, 'tap-your-day-v2');
  for (const [label, id, hash] of expected) {
    assert.equal(catalog.TAP_YOUR_DAY_CHOICES.find((choice) => choice.label === label)?.itemId, id);
    const file = path.join(root, 'apps/mobile/assets/items/each', `${id}.webp`);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash);
  }
  const builder = fs.readFileSync(path.join(root, 'tools/build-items-v19.py'), 'utf8');
  for (const [, id] of expected) assert.match(builder, new RegExp(`\\"${id}\\"`));
});

test('ItemSprite has one canonical path per item, without a Tap Your Day art branch', () => {
  const jsx = (type, props) => ({ type, props });
  const canonical = Object.fromEntries(expected.map(([, id]) => [id, `canonical:${id}`]));
  canonical.unrelated = 'canonical:unrelated';
  const source = fs.readFileSync(path.join(root, 'apps/mobile/src/components/ui/item-sprite.tsx'), 'utf8');
  assert.doesNotMatch(source, /TAP_YOUR_DAY_IMAGES|tapYourDay/);
  assert.equal(fs.existsSync(path.join(root, 'apps/mobile/src/lib/tap-your-day-images.ts')), false);
  const { ItemSprite } = load('apps/mobile/src/components/ui/item-sprite.tsx', {
    react: { memo: (fn) => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (value) => value } },
    'expo-image': { Image: 'Image' },
    '@novame/engine': { ITEM_DICTIONARY: { items: {} } },
    '../../lib/item-images.g': { ITEM_IMAGES: canonical },
    '../../lib/tap-person-images': { TAP_PERSON_IMAGES: people },
  });
  const art = (id) => ItemSprite({ itemId: id, size: 58 }).props.children.props.source;
  for (const [, id] of expected) assert.equal(art(id), canonical[id]);
  assert.equal(art('unrelated'), canonical.unrelated);
  for (const [id, file] of Object.entries(people)) assert.equal(art(id), file);
});

test('only the five distinct selection-only people items use a separate runtime map', () => {
  assert.equal(Object.keys(people).length, 5);
  assert.deepEqual(Object.keys(people).sort(), [
    'tap.person.family',
    'tap.person.friends',
    'tap.person.just_me',
    'tap.person.partner',
    'tap.person.pets',
  ]);
  for (const file of Object.values(people)) assert.match(path.basename(file), /^[A-Za-z0-9_.-]+$/);
});
