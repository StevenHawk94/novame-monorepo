/**
 * One-shot: verify the 16 scene pairs in R2's Maps/ folder, then merge the
 * `scenes` catalog into video-manifest.json (source of truth for the app's
 * Unlock New Scenes page — prices/plus flags live here, 2026-07-30).
 * The free default (Mushroom-Wood) is bundled in the app, not listed here.
 *
 * Run from apps/admin:  node scripts/update-scene-manifest.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand,
} from '@aws-sdk/client-s3';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const Bucket = process.env.R2_BUCKET_NAME;

// File stem (exact R2 spelling — Snowy-Moutain is intentional), price, plus.
const SCENES = [
  { stem: 'Aloha-Beach', price: 300, plusOnly: false },
  { stem: 'Ancient-Temple', price: 300, plusOnly: false },
  { stem: 'Arabic-Old-Town', price: 300, plusOnly: false },
  { stem: 'Candy-Store', price: 300, plusOnly: false },
  { stem: 'Carnival', price: 300, plusOnly: false },
  { stem: 'City-Corner', price: 300, plusOnly: false },
  { stem: 'Desert', price: 300, plusOnly: false },
  { stem: 'Fountain-Garden', price: 300, plusOnly: false },
  { stem: 'Lavender-Garden', price: 300, plusOnly: false },
  { stem: 'Secret-Garden', price: 300, plusOnly: false },
  { stem: 'Cowboy-Ranch', price: 500, plusOnly: false },
  { stem: 'Snowy-Moutain', price: 300, plusOnly: true },
  { stem: 'Echoing-Cave', price: 300, plusOnly: true },
  { stem: 'Cozy-Room', price: 300, plusOnly: true },
  { stem: 'Ship-Deck', price: 500, plusOnly: true },
  { stem: 'Show-Stage', price: 500, plusOnly: true },
];

const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: 'Maps/' }));
const keys = new Set((r.Contents ?? []).map((o) => o.Key));

let missing = 0;
const entries = SCENES.map((s) => {
  const image = `Maps/${s.stem}.webp`;
  const thumb = `Maps/${s.stem}-Small.webp`;
  for (const k of [image, thumb]) {
    if (!keys.has(k)) { console.error(`MISSING: ${k}`); missing++; }
  }
  return {
    key: s.stem.toLowerCase(),
    name: s.stem.replace(/-/g, ' '),
    price: s.price,
    plusOnly: s.plusOnly,
    image,
    thumb,
  };
});
if (missing > 0) {
  console.error(`\n${missing} files missing — manifest NOT updated.`);
  process.exit(1);
}
console.log(`All ${entries.length * 2} scene files verified present.`);

const get = await client.send(new GetObjectCommand({ Bucket, Key: 'video-manifest.json' }));
const chunks = [];
for await (const c of get.Body) chunks.push(c);
const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));

manifest.scenes = entries;
// Do NOT touch manifest.version: the mobile asset pipeline hard-asserts 'v1'.
manifest.version = 'v1';
manifest.scenesUpdatedAt = new Date().toISOString();

await client.send(new PutObjectCommand({
  Bucket, Key: 'video-manifest.json',
  Body: JSON.stringify(manifest, null, 2),
  ContentType: 'application/json',
}));
console.log(`Manifest updated: version=${manifest.version}, scenes=${entries.length}`);
