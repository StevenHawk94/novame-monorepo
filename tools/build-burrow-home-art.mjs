import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.35.0/node_modules/sharp/dist/index.mjs';

// The source sheets are opaque previews. Keep them untouched and produce
// individually cropped, transparent runtime assets from each cell.
const source = '/Users/nihao/Desktop/app final ui twist/app素材new/1. New Burrow/confirm/第一批上线测试';
const target = new URL('../apps/mobile/assets/burrow/home-v1/', import.meta.url).pathname;
await fs.mkdir(target, { recursive: true });

const sheets = [
  ['bunny.png', 'bunny', 1, 1],
  ['Carpet.png', 'rug', 1, 8],
  ['cusion.png', 'cushion', 2, 4],
  ['radio.png', 'radio', 2, 4],
  ['poster.png', 'poster', 2, 4],
  ['light string.png', 'light-string', 1, 8],
  ['photo frame.png', 'photo-frame', 2, 4],
  ['ladder.png', 'ladder', 2, 4],
  ['statue.png', 'statue', 2, 4],
  ['window.png', 'window', 2, 4],
  ['interactive toys.png', 'interactive-toy', 3, 2],
  ['flower.png', 'flower', 2, 4],
  ['装饰品.png', 'decoration', 2, 4],
  ['table.png', 'table', 2, 4],
  ['lamp.png', 'lamp', 2, 4],
  [new URL('./assets/burrow-home-inputs/dresser.webp', import.meta.url).pathname, 'dresser', 2, 4],
  [new URL('./assets/burrow-home-inputs/shelf.webp', import.meta.url).pathname, 'shelf', 1, 8],
  [new URL('./assets/burrow-home-inputs/envelope.webp', import.meta.url).pathname, 'envelope', 1, 1],
];

function exteriorAlpha(rgb, width, height, backgroundOverride) {
  const alpha = new Uint8Array(width * height).fill(255);
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const border = [];
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 100))) {
    for (const y of [0, height - 1]) border.push((y * width + x) * 3);
  }
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 100))) {
    for (const x of [0, width - 1]) border.push((y * width + x) * 3);
  }
  const bg = backgroundOverride ?? [0, 1, 2].map(channel => {
    const values = border.map(index => rgb[index + channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  const nearBackground = index => {
    const offset = index * 3;
    const dr = rgb[offset] - bg[0];
    const dg = rgb[offset + 1] - bg[1];
    const db = rgb[offset + 2] - bg[2];
    return dr * dr + dg * dg + db * db < 34 * 34;
  };
  let head = 0;
  let tail = 0;
  const push = index => {
    if (!seen[index] && nearBackground(index)) {
      seen[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    alpha[index] = 0;
    const x = index % width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (index >= width) push(index - width);
    if (index < width * (height - 1)) push(index + width);
  }
  // A garland or frame can enclose a large patch of sheet background; those
  // nearly neutral pixels must stay transparent even when not edge-connected.
  for (let index = 0; index < alpha.length; index++) {
    const offset = index * 3;
    const dr = rgb[offset] - bg[0], dg = rgb[offset + 1] - bg[1], db = rgb[offset + 2] - bg[2];
    if (dr * dr + dg * dg + db * db < 12 * 12) alpha[index] = 0;
  }
  return alpha;
}

function keepLargestShape(alpha, width, height) {
  const seen = new Uint8Array(alpha.length);
  const queue = new Int32Array(alpha.length);
  let largest = [];
  for (let start = 0; start < alpha.length; start++) {
    if (!alpha[start] || seen[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const index = queue[head++], x = index % width;
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, index >= width ? index - width : -1, index < width * (height - 1) ? index + width : -1]) {
        if (next >= 0 && alpha[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    if (tail > largest.length) largest = Array.from(queue.subarray(0, tail));
  }
  const keep = new Uint8Array(alpha.length);
  for (const index of largest) keep[index] = 1;
  for (let index = 0; index < alpha.length; index++) if (!keep[index]) alpha[index] = 0;
}

async function saveRgba(name, rgba, width, height, maxWidth = 960) {
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rgba[(y * width + x) * 4 + 3] < 12) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left || bottom <= top) throw new Error(`Empty cutout: ${name}`);
  const extract = { left: Math.max(0, left - 2), top: Math.max(0, top - 2), width: Math.min(width, right + 2) - Math.max(0, left - 2), height: Math.min(height, bottom + 2) - Math.max(0, top - 2) };
  const output = path.join(target, `${name}.webp`);
  let pipeline = sharp(rgba, { raw: { width, height, channels: 4 } }).extract(extract);
  if (extract.width > maxWidth) pipeline = pipeline.resize({ width: maxWidth });
  await pipeline.webp({ quality: 88, effort: 3 }).toFile(output);
  return { file: `${name}.webp`, ...extract };
}

for (const [file, name, columns, rows] of sheets) {
  const input = path.isAbsolute(file) ? file : path.join(source, file);
  const info = await sharp(input).metadata();
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const left = Math.round(column * info.width / columns);
    const top = Math.round(row * info.height / rows);
    const right = Math.round((column + 1) * info.width / columns);
    const bottom = Math.round((row + 1) * info.height / rows);
    const width = right - left, height = bottom - top;
    const rgb = await sharp(input).extract({ left, top, width, height }).removeAlpha().raw().toBuffer();
    const alpha = exteriorAlpha(rgb, width, height, name === 'interactive-toy' ? [242, 226, 199] : undefined);
    if (name === 'interactive-toy') keepLargestShape(alpha, width, height);
    const rgba = Buffer.alloc(width * height * 4);
    for (let index = 0; index < alpha.length; index++) {
      rgba[index * 4] = rgb[index * 3];
      rgba[index * 4 + 1] = rgb[index * 3 + 1];
      rgba[index * 4 + 2] = rgb[index * 3 + 2];
      rgba[index * 4 + 3] = alpha[index];
    }
    const variant = rows * columns === 1 ? name : `${name}-${String(row * columns + column + 1).padStart(2, '0')}`;
    await saveRgba(variant, rgba, width, height);
    console.log(variant);
  }
}

// The positioning reference also includes composed variants that differ from
// the supplied sprite sheets (the curtained window and decorated objects).
// Isolate these against the matching bottom-cropped background while keeping
// the separately supplied dresser, shelf and envelope as source assets.
const designWidth = 900, designHeight = 1950;
const bgSource = path.join(source, 'home-background.png');
const bgScaled = await sharp(bgSource).resize({ width: designWidth }).toBuffer({ resolveWithObject: true });
const bgTop = bgScaled.info.height - designHeight;
const background = await sharp(bgScaled.data).extract({ left: 0, top: bgTop, width: designWidth, height: designHeight }).removeAlpha().raw().toBuffer();
await sharp(background, { raw: { width: designWidth, height: designHeight, channels: 3 } }).webp({ quality: 90, effort: 3 }).toFile(path.join(target, 'home-background.webp'));
const composition = await sharp(path.join(source, '各素材图中位置.png')).removeAlpha().raw().toBuffer();

const positioned = [
  ['light-string', 130, 420, 600, 135],
  ['window', 165, 570, 225, 245],
  ['shelf-radio', 550, 580, 275, 210],
  ['poster', 205, 812, 150, 190],
  ['dresser', 330, 1007, 318, 242],
  ['statue', 480, 870, 130, 185],
  ['lamp', 85, 1010, 150, 180],
  ['cushion', 98, 1220, 360, 230],
  ['rug', 428, 1320, 465, 160],
  ['stump-table', 520, 1190, 270, 260],
  ['envelope', 568, 1200, 100, 95],
  ['flowers', 625, 1080, 165, 260],
  ['bunny', 165, 1080, 250, 300],
  ['ladder', 790, 810, 110, 510],
];

const layout = [];
for (const [name, x, y, width, height] of positioned) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const sourceOffset = ((y + row) * designWidth + (x + column)) * 3;
    const index = (row * width + column) * 4;
    const difference = Math.max(
      Math.abs(composition[sourceOffset] - background[sourceOffset]),
      Math.abs(composition[sourceOffset + 1] - background[sourceOffset + 1]),
      Math.abs(composition[sourceOffset + 2] - background[sourceOffset + 2]),
    );
    rgba[index] = composition[sourceOffset];
    rgba[index + 1] = composition[sourceOffset + 1];
    rgba[index + 2] = composition[sourceOffset + 2];
    let coverage = difference <= 12 ? 0 : difference >= 28 ? 255 : Math.round((difference - 12) / 16 * 255);
    if (name === 'cushion' && (composition[sourceOffset + 1] < composition[sourceOffset] + 12 || composition[sourceOffset + 2] < composition[sourceOffset] + 5)) coverage = 0;
    if (name === 'window') {
      const absoluteX = x + column, absoluteY = y + row;
      const inArch = absoluteY >= 680 || ((absoluteX - 278) / 100) ** 2 + ((absoluteY - 690) / 101) ** 2 <= 1;
      const inShape = absoluteX >= 176 && absoluteX <= 379 && absoluteY >= 590 && absoluteY <= 803 && inArch;
      if (!inShape) coverage = 0;
    }
    rgba[index + 3] = coverage;
  }
  const cutout = await saveRgba(`placed-${name}`, rgba, width, height);
  layout.push({ name, x: x + cutout.left, y: y + cutout.top, width: cutout.width, height: cutout.height });
}
await fs.writeFile(path.join(target, 'positioned-layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
for (const stale of ['placed-photo-frame.webp', 'placed-interactive-toy.webp']) {
  await fs.unlink(path.join(target, stale)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
console.log(`Wrote ${layout.length} placed Home cutouts and all source-sheet variants to ${target}`);
