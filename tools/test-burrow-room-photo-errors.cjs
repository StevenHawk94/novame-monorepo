const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

const { roomPhotoFailureCode, roomPhotoFailureMessage, TOY_PHOTO_DAILY_LIMIT_MESSAGE } =
  load('apps/mobile/src/lib/room-photo-errors.ts');

test('daily Toy photo limit uses the requested Plus/tomorrow copy without changing the quota error', () => {
  assert.equal(TOY_PHOTO_DAILY_LIMIT_MESSAGE, 'Join plus to enable more photos used on your plushie, or come back tomorrow;');
  assert.equal(roomPhotoFailureMessage({ body: { error: 'daily_limit_reached' } }, 'camera failed'),
    TOY_PHOTO_DAILY_LIMIT_MESSAGE);
  assert.equal(roomPhotoFailureCode(new Error('daily_limit_reached')), 'daily_limit_reached');
});

test('other photo failures are not mislabeled as camera failures', () => {
  assert.match(roomPhotoFailureMessage({ body: { error: 'upload_limit' } }, 'camera failed'), /hour/);
  assert.match(roomPhotoFailureMessage({ body: { error: 'photo_unavailable' } }, 'camera failed'), /saved/);
  assert.equal(roomPhotoFailureMessage(new Error('native camera error'), 'camera failed'), 'camera failed');
});
