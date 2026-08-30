/* Offline regression tests for server-owned daily boundaries. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/api/src/lib/user-local-date.js'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true },
}).outputText;
const moduleBox = { exports: {} };
vm.runInNewContext(code, { module: moduleBox, exports: moduleBox.exports, Intl, Date }, {
  filename: 'apps/api/src/lib/user-local-date.js',
});
const { dateKeyInTimeZone } = moduleBox.exports;

test('the same instant resolves to each profile timezone date', () => {
  const instant = new Date('2026-08-29T06:30:00.000Z');
  assert.equal(dateKeyInTimeZone('America/Los_Angeles', instant), '2026-08-28');
  assert.equal(dateKeyInTimeZone('Asia/Tokyo', instant), '2026-08-29');
});

test('invalid or missing timezones fail safely to UTC', () => {
  const instant = new Date('2026-08-29T23:30:00.000Z');
  assert.equal(dateKeyInTimeZone('not/a-zone', instant), '2026-08-29');
  assert.equal(dateKeyInTimeZone(null, instant), '2026-08-29');
});

test('reward mutation routes no longer trust caller localDate', () => {
  const routes = [
    'focus/route.js', 'lens/complete/route.js', 'quests/check/route.js',
    'quests/start/route.js', 'tame-enemy/route.js', 'bubbles/pop/route.js',
    'kit/quiet-wins/route.js', 'kit/true-north/route.js', 'reflect/prepare/route.js',
    'master/ask/route.js',
  ];
  for (const route of routes) {
    const text = fs.readFileSync(path.join(root, 'apps/api/src/app/api', route), 'utf8');
    assert.match(text, /resolveUserLocalDate\(supabase, (?:userId|input\.userId)\)/, route);
  }
});
