// Exercise the real reveal JSX and seeded sampler without native/network I/O.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let clock = '2026-08-26T12:00:00Z';
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
}
function load(file, imports = {}, expose = '') {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + expose, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, Date: TestDate,
    require(name) {
      if (name in imports) return imports[name];
      if (name.endsWith('.png')) return name;
      throw new Error('Unexpected import: ' + name);
    },
  });
  return module.exports;
}
const domain = {
  ...load('packages/domain/src/dimensions.ts'),
  ...load('packages/domain/src/true-north.ts'),
};
const jsx = (type, props) => ({ type, props });
const { __test: reveal } = load('apps/mobile/app/(main)/true-north.tsx', {
  react: { useMemo: (fn) => fn() },
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': {
    ...Object.fromEntries(['ActivityIndicator', 'Image', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name])),
    StyleSheet: { create: (value) => value },
  },
  'react-native-safe-area-context': {},
  'expo-router': {},
  '@novame/domain': domain,
  '@novame/engine': {},
  '../../src/components/ui/grid-background': {},
  '../../src/components/main/clover-burst': {},
  '../../src/lib/cosmetics-api': {},
  '../../src/lib/haptics': {},
  '../../src/components/ui/spring-pop': { SpringPop: 'SpringPop' },
  '../../src/lib/true-north-api': {},
}, '\nexport const __test = { Reveal, stableSample, currentLocalWeekSeed };');
const flat = (value) => [value].flat(Infinity).filter((child) => child != null && child !== false);
function nodes(tree) { return flat(tree).flatMap((node) => [node, ...nodes(node?.props?.children)]); }
function result(ranking) {
  const tree = reveal.Reveal({ ranking, lastRanking: null, showReward: false, colors: {}, onDone() {} });
  function lines(title) {
    const card = nodes(tree).find((node) => node.type === 'SpringPop' && nodes(node).includes(title));
    assert.ok(card, title);
    return flat(card.props.children).filter((node) => node.type === 'Text')
      .map((node) => flat(node.props.children).join('').replace(/^•\s*/, ''));
  }
  return { focus: lines('What matters to you most:'), release: lines('What you should forgive and forget') };
}
const ids = Array.from(domain.DIMENSION_IDS);

test('all 56 possible bottom pairs show exactly 3 from each pool and 6 unique lines', () => {
  for (const seventh of ids) for (const eighth of ids) {
    if (seventh === eighth) continue;
    const ranking = [...ids.filter((id) => id !== seventh && id !== eighth), seventh, eighth];
    const { release } = result(ranking);
    assert.equal(release.length, 6);
    assert.equal(new Set(release).size, 6);
    assert.ok(release.slice(0, 3).every((line) => domain.TRUE_NORTH_RELEASE_POINTS[seventh].includes(line)));
    assert.ok(release.slice(3).every((line) => domain.TRUE_NORTH_RELEASE_POINTS[eighth].includes(line)));
    assert.deepEqual(Array.from(ranking.slice(-2)), [seventh, eighth]);
  }
});

test('top-three focus contents and sampling remain unchanged (3 each, 9 total)', () => {
  for (let offset = 0; offset < ids.length; offset++) {
    const ranking = [...ids.slice(offset), ...ids.slice(0, offset)];
    const seed = reveal.currentLocalWeekSeed() + ':' + ranking.join(',');
    const expected = ranking.slice(0, 3).flatMap((dim) =>
      Array.from(reveal.stableSample(domain.TRUE_NORTH_FOCUS_POINTS[dim], 3, seed + ':' + dim)));
    assert.deepEqual(result(ranking).focus, expected);
    assert.equal(expected.length, 9);
  }
});

test('rerenders, cloned cached rankings and reopening within the same seed period stay stable', () => {
  clock = '2026-08-26T12:00:00Z';
  const first = result(ids).release;
  assert.deepEqual(result([...ids]).release, first);
  clock = '2026-08-27T12:00:00Z';
  assert.deepEqual(result([...ids]).release, first);
});

test('new weekly seeds sample different subsets rather than always choosing the first three', () => {
  const combinations = new Set();
  for (let week = 0; week < 12; week++) {
    clock = new Date(Date.UTC(2026, 8, 2 + week * 7, 12)).toISOString();
    combinations.add(JSON.stringify(result(ids).release));
  }
  assert.ok(combinations.size > 1);
});

test('sampling never mutates the ranking or the shared copy pools', () => {
  const before = JSON.stringify(domain.TRUE_NORTH_RELEASE_POINTS);
  const ranking = Object.freeze([...ids]);
  result(ranking); result(ranking);
  assert.equal(JSON.stringify(domain.TRUE_NORTH_RELEASE_POINTS), before);
  for (const id of ids) {
    assert.equal(domain.TRUE_NORTH_RELEASE_POINTS[id].length, 6);
  }
});
