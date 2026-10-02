const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

const { centeredRoomPhotoCrop, positionedFrameCrop } = load('apps/mobile/src/lib/room-photo-crop.ts');

test('frame crops are exact 5:7 and doll crops stay square', () => {
  const frame = centeredRoomPhotoCrop(1200, 800, 'frame');
  assert.equal(frame.width * 7, frame.height * 5);
  assert.equal(frame.originX, Math.floor((1200 - frame.width) / 2));
  const doll = centeredRoomPhotoCrop(1200, 800, 'doll');
  assert.equal(doll.width, doll.height);
});

test('dragged frame crop matches its preview and stays inside the image', () => {
  const { crop, offsetX, offsetY } = positionedFrameCrop(1200, 800, 250, 1.4, 9999, -9999);
  assert.equal(crop.width * 7, crop.height * 5);
  assert.ok(crop.originX >= 0 && crop.originX + crop.width <= 1200);
  assert.ok(crop.originY >= 0 && crop.originY + crop.height <= 800);
  assert.ok(Number.isFinite(offsetX) && Number.isFinite(offsetY));
});
