const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const accountScreen = read('apps/mobile/app/(main)/(modals)/account-management.tsx');
const avatarLib = read('apps/mobile/src/lib/avatar.ts');
const accountApi = read('apps/mobile/src/lib/account-api.ts');
const updateProfile = read('apps/api/src/app/api/update-profile/route.js');
const userSync = read('apps/api/src/app/api/user-sync/route.js');
const envExample = read('apps/api/.env.example');
const appConfig = read('apps/mobile/app.json');

for (const id of Array.from({ length: 10 }, (_, index) => `default-${index + 1}`)) {
  assert.match(avatarLib, new RegExp(`['\"]${id}['\"]`));
  assert.match(updateProfile, new RegExp(`['\"]${id}['\"]`));
  assert.match(userSync, new RegExp(`['\"]${id}['\"]`));
  // IDs remain valid for old stored profiles; their retired image files are
  // deliberately absent from the new initial-avatar renderer and may be deleted.
}

assert.doesNotMatch(accountScreen, /DEFAULT_AVATAR_OPTIONS\.map/);
assert.match(accountScreen, /AccountManagementScreen/);
assert.doesNotMatch(avatarLib, /assets\/profile/);
assert.doesNotMatch(accountScreen, /styles\.avatarCheck/);
assert.match(read('apps/mobile/app/(main)/(modals)/me.tsx'), /ProfileAvatarEditor/);
assert.doesNotMatch(accountScreen, /ImagePicker|ImageManipulator|Upload New/);
assert.match(accountApi, /defaultAvatarId/);
assert.doesNotMatch(accountApi, /FormData/);
assert.match(accountApi, /upload-avatar/); // onboarding now also permits profile photos
assert.match(updateProfile, /is_default_avatar\s*=\s*true/);
assert.doesNotMatch(updateProfile, /avatarUrl/);
assert.doesNotMatch(userSync, /body\.avatarUrl/);
assert.equal(fs.existsSync(path.join(root, 'apps/api/src/app/api/upload-avatar/route.js')), true);
assert.match(read('apps/api/src/app/api/upload-avatar/route.js'), /verifyToken/);
assert.doesNotMatch(envExample, /GOOGLE_CLOUD_VISION_API_KEY/);
assert.match(appConfig, /expo-image-picker/);

console.log('fixed avatar selection checks passed');
