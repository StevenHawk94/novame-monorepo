const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./lifecycle-test-utils.cjs');

const { centeredRoomPhotoCrop, positionedFrameCrop } = load('apps/mobile/src/lib/room-photo-crop.ts');
const {positionedDollCrop}=load('apps/mobile/src/lib/room-photo-crop.ts');
test('Plushie drag/zoom uses the exact square photo plane behind the costume opening, with bounded source pixels',()=>{
 for(const [w,h] of [[800,1200],[2000,700],[600,600]])for(const z of [1,1.01,1.5,3])for(const x of [-9999,0,9999])for(const y of [-9999,0,9999]){
  const g=positionedDollCrop(w,h,180,z,x,y),c=g.crop;
  assert.equal(c.width,c.height);assert.ok(c.originX>=0&&c.originY>=0&&c.originX+c.width<=w+1e-9&&c.originY+c.height<=h+1e-9);
  assert.ok(Math.abs(g.scale*c.width-180)<1e-8);
  assert.ok(Math.abs((180-w*g.scale)/2+g.offsetX+c.originX*g.scale)<1e-8,'saved crop and visible left edge agree');
 }
});

test('frame crops are 201:290 and doll crops stay square', () => {
  const frame = centeredRoomPhotoCrop(1200, 800, 'frame');
  assert.ok(Math.abs(frame.width * 290 - frame.height * 201) < 1e-8);
  assert.equal(frame.originX, (1200 - frame.width) / 2);
  const doll = centeredRoomPhotoCrop(1200, 800, 'doll');
  assert.equal(doll.width, doll.height);
});

test('dragged frame crop matches its preview and stays inside the image', () => {
  const { crop, offsetX, offsetY } = positionedFrameCrop(1200, 800, 250, 1.4, 9999, -9999);
  assert.ok(Math.abs(crop.width * 290 - crop.height * 201) < 1e-8);
  assert.ok(crop.originX >= 0 && crop.originX + crop.width <= 1200);
  assert.ok(crop.originY >= 0 && crop.originY + crop.height <= 800);
  assert.ok(Number.isFinite(offsetX) && Number.isFinite(offsetY));
});

test('frame zoom stays smooth, without quantizing to 201-pixel steps', () => {
  const a = positionedFrameCrop(500, 700, 250, 1, 0, 0);
  const b = positionedFrameCrop(500, 700, 250, 1.01, 0, 0);
  assert.ok(b.crop.width < a.crop.width);
  assert.ok(a.crop.width - b.crop.width < 5);
});
