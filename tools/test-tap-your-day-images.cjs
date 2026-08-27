/* Run: node --test tools/test-tap-your-day-images.cjs. No native runtime or network. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
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
const map = load('apps/mobile/src/lib/tap-your-day-images.ts', {}, true).TAP_YOUR_DAY_IMAGES;
const people = load('apps/mobile/src/lib/tap-person-images.ts', {}, true).TAP_PERSON_IMAGES;
const catalog = load('packages/engine/src/items/tap-your-day.ts', {
  './tap-your-day-v1.json': require('../packages/engine/src/items/tap-your-day-v1.json'),
});
const expected = [
  ['Learning', 'memory.3006_globe', 'each/memory.5431_book_light.webp'],
  ['Relaxing', 'memory.1421_bed', 'each/memory.1457_bedroom.webp'],
  ['Commuting', 'memory.2127_bus', 'each/memory.1439_car.webp'],
  ['Noodles', 'memory.0718_rice_noodles', 'each/memory.0050_ramen.webp'],
  ['Work', 'memory.1541_workplace', 'tap-person/Work.webp'],
  ['Appointments', 'memory.1435_appointment_book', 'tap-person/Appointment.webp'],
  ['Yoga', 'memory.1304_yoga', 'tap-person/Yoga.webp'],
  ['Socializing', 'memory.1403_picnic', 'tap-person/Socializing.webp'],
  ['Date', 'memory.1491_restaurant', 'tap-person/Date.webp'],
  ['Events', 'memory.2261_event_ticket', 'tap-person/Event.webp'],
  ['Volunteering', 'memory.1594_volunteer_center', 'tap-person/Volunteering.webp'],
  ['Movies', 'memory.1363_movie_theater', 'tap-person/Movie.webp'],
  ['TV', 'memory.1362_television', 'tap-person/TV.webp'],
  ['Social Media', 'memory.5385_social_media', 'tap-person/social-media.webp'],
  ['Writing', 'memory.2876_notebook', 'tap-person/Writing.webp'],
];
test('all 15 choices map to the requested artwork without changing their persisted IDs', () => {
  assert.equal(Object.keys(map).length, 15);
  assert.equal(catalog.TAP_YOUR_DAY_CHOICES.length, 131);
  assert.equal(catalog.TAP_YOUR_DAY_VERSION, 'tap-your-day-v2');
  for (const [label, id, asset] of expected) {
    assert.equal(catalog.TAP_YOUR_DAY_CHOICES.find((choice) => choice.label === label)?.itemId, id);
    assert.equal(map[id], path.join(root, 'apps/mobile/assets/items', asset));
    const bytes = fs.readFileSync(map[id]);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    // Check case even on macOS's default case-insensitive filesystem.
    assert.ok(fs.readdirSync(path.dirname(map[id])).includes(path.basename(map[id])));
  }
});
test('curated asset names are safe to concatenate into native Metro image URLs', () => {
  // Native AssetSourceResolver concatenates asset.name without URI-encoding it.
  for (const file of [...Object.values(map), ...Object.values(people)]) {
    assert.match(path.basename(file), /^[A-Za-z0-9_.-]+$/, file);
  }
  assert.equal(path.basename(map['memory.5385_social_media']), 'social-media.webp');
});
test('all new tap-person artwork is covered, without replacing the five existing people icons', () => {
  const directory = path.join(root, 'apps/mobile/assets/items/tap-person');
  const actual = fs.readdirSync(directory).filter((name) => name.endsWith('.webp')).sort();
  const mapped = [...Object.values(map).filter((file) => path.dirname(file) === directory), ...Object.values(people)]
    .map((file) => path.basename(file)).sort();
  assert.deepEqual(mapped, actual);
  assert.equal(Object.keys(people).length, 5);
  for (const id of Object.keys(people)) assert.equal(map[id], undefined);
});
test('ItemSprite opts in only for Tap Your Day; core art and people fallbacks remain intact', () => {
  const jsx = (type, props) => ({ type, props });
  const base = Object.fromEntries(expected.map(([, id]) => [id, 'core:' + id]));
  base.unrelated = 'core:unrelated';
  const { ItemSprite } = load('apps/mobile/src/components/ui/item-sprite.tsx', {
    react: { memo: (fn) => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: (value) => value } },
    'expo-image': { Image: 'Image' },
    '@novame/engine': { ITEM_DICTIONARY: { items: {} } },
    '../../lib/item-images.g': { ITEM_IMAGES: base },
    '../../lib/tap-person-images': { TAP_PERSON_IMAGES: people },
    '../../lib/tap-your-day-images': { TAP_YOUR_DAY_IMAGES: map },
  });
  const art = (id, flag) => ItemSprite({ itemId: id, size: 58, tapYourDay: flag }).props.children.props.source;
  for (const [, id] of expected) {
    assert.equal(art(id), base[id]);
    assert.equal(art(id, false), base[id]);
    assert.equal(art(id, true), map[id]);
  }
  assert.equal(art('unrelated', true), base.unrelated);
  for (const [id, file] of Object.entries(people)) {
    assert.equal(art(id), file);
    assert.equal(art(id, true), file);
  }
});
