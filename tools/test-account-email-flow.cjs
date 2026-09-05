const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('connected-account email entry stays visible above the keyboard', () => {
  const source = read('apps/mobile/app/(main)/(modals)/connect-account.tsx');
  assert.match(source, /KeyboardAvoidingView/);
  assert.match(source, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  assert.match(source, /keyboardShouldPersistTaps="handled"/);
  assert.match(source, /inner: \{ flexGrow: 1/);
});

test('email binding verifies an email-change OTP and existing email restores its account', () => {
  const source = read('apps/mobile/src/lib/auth.ts');
  assert.match(source, /supabase\.auth\.updateUser\(\{ email \}\)/);
  assert.match(source, /type: 'email_change'/);
  assert.match(source, /isAlreadyBoundError\(error\.message, error\.code\)/);
  assert.match(source, /options: \{ shouldCreateUser: false \}/);
  assert.match(source, /verifyOtp\(\{ email, token, type: 'email' \}\)/);
});

test('support email placeholder is explicitly left aligned', () => {
  const source = read('apps/mobile/app/(main)/(modals)/support.tsx');
  assert.match(source, /placeholder="Where should we reply\?"[\s\S]*style=\{\[styles\.input, styles\.emailInput\]\}/);
  assert.match(source, /emailInput: \{\s*textAlign: 'left'/);
});
