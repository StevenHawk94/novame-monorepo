/** Split the five supplied icon contact sheets into small transparent WebP sprites. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from '../node_modules/.pnpm/sharp@0.35.0/node_modules/sharp/dist/index.mjs';

const source = '/Users/nihao/Desktop/app final ui twist/app素材new/1. New Burrow/confirm/game room icons';
const target = new URL('../apps/mobile/assets/burrow/game-room-v1/', import.meta.url).pathname;
const catalog = JSON.parse(await fs.readFile(new URL('../apps/api/src/data/burrow-game-room-v1.json', import.meta.url), 'utf8'));
const sheets = [
  ['Kiss Style → Work-Life Mode.png', 0, 16, [0, 400, 690, 970, 1388], [0, 283, 566, 850, 1133]],
  ['Social Battery → Little Gestures.png', 16, 16, [0, 410, 700, 985, 1388], [0, 310, 566, 850, 1133]],
  ['Gift Game → Jealousy & Insecurity.png', 32, 16, [0, 370, 650, 895, 1199], [0, 328, 656, 984, 1312]],
  ['Big Dreams & Fears → Inside Jokes.png', 48, 16, [0, 450, 710, 990, 1388], [0, 310, 575, 825, 1133]],
  ['Our Song & Playlist → Relationship Milestones.png', 64, 6, [0, 470, 941], [0, 418, 836, 1254, 1672]],
];
await fs.mkdir(target, { recursive: true });

function median(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function cornerColor(rgb, width, height, x0, y0) {
  const channels = [[], [], []];
  for (let y = y0; y < y0 + 12; y++) for (let x = x0; x < x0 + 12; x++) {
    const offset = (y * width + x) * 3;
    for (let c = 0; c < 3; c++) channels[c].push(rgb[offset + c]);
  }
  return channels.map(median);
}

async function cutIcon(input, cell, id) {
  const { left, top, width, height } = cell;
  const rgb = await sharp(input).extract(cell).removeAlpha().raw().toBuffer();
  const corners = [
    cornerColor(rgb, width, height, 0, 0),
    cornerColor(rgb, width, height, width - 12, 0),
    cornerColor(rgb, width, height, 0, height - 12),
    cornerColor(rgb, width, height, width - 12, height - 12),
  ];
  const rgba = Buffer.alloc(width * height * 4);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = x / Math.max(1, width - 1), u = y / Math.max(1, height - 1);
    const sourceIndex = (y * width + x) * 3;
    const targetIndex = (y * width + x) * 4;
    let difference = 0;
    for (let c = 0; c < 3; c++) {
      const background = corners[0][c] * (1 - t) * (1 - u) + corners[1][c] * t * (1 - u)
        + corners[2][c] * (1 - t) * u + corners[3][c] * t * u;
      const delta = rgb[sourceIndex + c] - background;
      difference += delta * delta;
      rgba[targetIndex + c] = rgb[sourceIndex + c];
    }
    const distance = Math.sqrt(difference);
    const alpha = Math.round(Math.max(0, Math.min(1, (distance - 8) / 15)) * 255);
    rgba[targetIndex + 3] = alpha;
    if (alpha >= 128) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  if (maxX <= minX || maxY <= minY) throw new Error(`Empty icon ${id} in ${input}`);
  const pad = 8;
  const bounds = {
    left: Math.max(0, minX - pad), top: Math.max(0, minY - pad),
    width: Math.min(width, maxX + pad + 1) - Math.max(0, minX - pad),
    height: Math.min(height, maxY + pad + 1) - Math.max(0, minY - pad),
  };
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .extract(bounds).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 86, effort: 5 }).toFile(path.join(target, `${id}.webp`));
  return { id, sourceCell: { left, top, width, height }, crop: bounds };
}

const manifest = [];
for (const [name, offset, count, rowBounds, columnBounds] of sheets) {
  const input = path.join(source, name);
  const info = await sharp(input).metadata();
  if (rowBounds.at(-1) !== info.height || columnBounds.at(-1) !== info.width) throw new Error(`Unexpected sheet dimensions for ${name}`);
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / 4), column = index % 4;
    const left = columnBounds[column];
    const top = rowBounds[row];
    const right = columnBounds[column + 1];
    const bottom = rowBounds[row + 1];
    const id = catalog.games[offset + index].id;
    manifest.push(await cutIcon(input, { left, top, width: right - left, height: bottom - top }, id));
  }
}
if (manifest.length !== 70 || new Set(manifest.map(icon => icon.id)).size !== 70) throw new Error('Expected exactly 70 unique sprites');

const background = process.argv[2];
const hero = process.argv[3];
if (!background || !hero) throw new Error('Usage: node tools/build-burrow-game-room-art.mjs <background.png> <hero.png>');
await sharp(background).resize({ width: 900 }).webp({ quality: 87, effort: 5 }).toFile(path.join(target, 'background.webp'));
await sharp(hero).resize({ width: 1100 }).webp({ quality: 87, effort: 5 }).toFile(path.join(target, 'hero.webp'));
await fs.writeFile(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const artModule = new URL('../apps/mobile/src/lib/burrow-game-room-art.ts', import.meta.url);
await fs.writeFile(artModule, [
  '// Generated by tools/build-burrow-game-room-art.mjs. All paths must stay static for Metro.',
  "import type { ImageSourcePropType } from 'react-native';",
  '',
  "export const gameRoomBackground = require('../../assets/burrow/game-room-v1/background.webp') as ImageSourcePropType;",
  "export const gameRoomHero = require('../../assets/burrow/game-room-v1/hero.webp') as ImageSourcePropType;",
  'export const gameRoomIcons: Record<string, ImageSourcePropType> = {',
  ...manifest.map(({ id }) => `  '${id}': require('../../assets/burrow/game-room-v1/${id}.webp') as ImageSourcePropType,`),
  '};',
  '',
].join('\n'));
console.log(`Wrote ${manifest.length} transparent icons, background and hero to ${target}`);
