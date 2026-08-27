#!/usr/bin/env node
/* Exact, deterministic crop of the user's five transparent people stickers.
 * Only writes these five dedicated files; never touches the generated item atlas.
 * node tools/crop-tap-person-icons.cjs [source.png]
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sharp = require(require.resolve('sharp', {
  paths: [path.dirname(require.resolve('next', { paths: [path.join(root, 'apps/api')] }))],
}));
const names = ['just_me', 'partner', 'family', 'friends', 'pets'];
const output = path.join(root, 'apps/mobile/assets/items/tap-person');

async function main() {
  const source = process.argv[2] || path.join(root, 'tools/item-source/tap-your-day/people.png');
  const meta = await sharp(source).metadata();
  assert.ok(meta.hasAlpha, 'Source must retain its original transparent background');
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Whitespace between the stickers gives exact column bands, not guessed grid cells.
  const bands = [];
  let start = -1;
  for (let x = 0; x <= info.width; x++) {
    let occupied = false;
    for (let y = 0; x < info.width && y < info.height; y++) {
      if (data[(y * info.width + x) * 4 + 3] > 0) { occupied = true; break; }
    }
    if (occupied && start < 0) start = x;
    if (!occupied && start >= 0) { bands.push([start, x - 1]); start = -1; }
  }
  assert.equal(bands.length, 5, 'Expected exactly five separate stickers; refusing ambiguous crops');
  fs.mkdirSync(output, { recursive: true });
  for (const [index, [left, right]] of bands.entries()) {
    let top = info.height, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = left; x <= right; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 0) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
    const resized = await sharp(source).extract(crop).resize(224, 224, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    const padX = Math.floor((256 - resized.info.width) / 2);
    const padY = Math.floor((256 - resized.info.height) / 2);
    const dest = path.join(output, names[index] + '.webp');
    await sharp(resized.data).extend({
      left: padX, right: 256 - resized.info.width - padX,
      top: padY, bottom: 256 - resized.info.height - padY,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).webp({ lossless: true }).toFile(dest);
    console.log(names[index], crop, fs.statSync(dest).size + ' bytes');
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
