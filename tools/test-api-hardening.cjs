const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('dev tier elevation uses a server-side user allowlist only', () => {
  const route = read('apps/api/src/app/api/dev/set-tier/route.js');
  const mobile = read('apps/mobile/src/lib/subscription.ts');
  const mobileEnv = read('apps/mobile/.env.example');
  assert.match(route, /DEV_TIER_TESTER_IDS/);
  assert.doesNotMatch(route, /DEV_TIER_SECRET|x-dev-tier-secret/);
  assert.doesNotMatch(mobile, /EXPO_PUBLIC_DEV_TIER_SECRET|x-dev-tier-secret/);
  assert.doesNotMatch(mobileEnv, /DEV_TIER_SECRET/);
});

test('account deletion never reports success after profile, storage, or auth failure', () => {
  const route = read('apps/api/src/app/api/delete-account/route.js');
  assert.match(route, /if \(profileError\) throw profileError/);
  assert.match(route, /if \(authError\) throw authError/);
  assert.match(route, /Account deletion is incomplete/);
  assert.doesNotMatch(route, /即使 Auth 删除失败，数据已经删除，仍返回成功/);
});

test('public and invite codes use Web Crypto rather than Math.random', () => {
  const api = [
    'apps/api/src/app/api/friends/status/route.js',
    'apps/api/src/app/api/duo/status/route.js',
    'apps/api/src/app/api/apple-iap/route.js',
  ].map(read).join('\n');
  assert.match(api, /secureCode/);
  assert.doesNotMatch(api, /Math\.random/);
});

test('Good Vibes entry status is server-owned and exposes the daily send state', () => {
  const route = read('apps/api/src/app/api/friends/good-vibes/route.js');
  const mobileApi = read('apps/mobile/src/lib/friends-api.ts');
  const friendsScreen = read('apps/mobile/app/(main)/(tabs)/friends.tsx');
  assert.match(route, /resolveUserLocalDate\(supabase, userId\)/);
  assert.match(route, /sentToday: !!sentToday, localDate/);
  assert.match(mobileApi, /fetchGoodVibeDailyStatus/);
  assert.match(friendsScreen, /dailyStatus\?\.sentToday === true/);
  assert.match(friendsScreen, /Come back tomorrow!/);
});
