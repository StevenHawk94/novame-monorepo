/**
 * One-shot: verify the 11 outfit asset trios in R2, then merge the
 * `outfits` catalog into video-manifest.json (source of truth for the
 * app's Bunny Closet — prices/plus flags live here, 2026-07-30).
 *
 * Run from apps/admin:  node scripts/update-outfit-manifest.mjs
 * Reads R2 creds from .env.local (same vars as src/lib/r2-client.js).
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

const OUTFITS = [
  { name: 'Aloha Friday', price: 500, plusOnly: false },
  { name: 'Green Fuzzy', price: 600, plusOnly: false },
  { name: 'Granny Sweater', price: 600, plusOnly: false },
  { name: 'Candy Cape', price: 600, plusOnly: false },
  { name: 'Exotic Princess', price: 800, plusOnly: false },
  { name: 'Red Hood', price: 800, plusOnly: false },
  { name: 'Pilot Jacket', price: 800, plusOnly: false },
  { name: 'Sweetheart Maid', price: 800, plusOnly: true },
  { name: 'Pirate Set', price: 800, plusOnly: true },
  { name: 'Magician Set', price: 800, plusOnly: true },
  { name: 'Yeehaw Sheriff', price: 1000, plusOnly: true },
];

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function listAll(prefix) {
  const keys = [];
  let token;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) keys.push(o.Key);
    token = r.NextContinuationToken;
  } while (token);
  return new Set(keys);
}

const outfitKeys = await listAll('Outfits/');
const videoKeys = await listAll('Character Videos/');
console.log(`R2: ${outfitKeys.size} objects under Outfits/, ${videoKeys.size} under Character Videos/`);

let missing = 0;
const entries = OUTFITS.map((o) => {
  const thumb = `Outfits/${o.name}.webp`;
  const bunny = `Outfits/${o.name}-Bunny.webp`;
  const video = `Character Videos/${o.name}.mov`;
  for (const [label, key, set] of [
    ['thumb', thumb, outfitKeys], ['bunny', bunny, outfitKeys], ['video', video, videoKeys],
  ]) {
    if (!set.has(key)) { console.error(`MISSING ${label}: ${key}`); missing++; }
  }
  return { key: slug(o.name), name: o.name, price: o.price, plusOnly: o.plusOnly, thumb, bunny, video };
});
if (missing > 0) {
  console.error(`\n${missing} assets missing — manifest NOT updated.`);
  process.exit(1);
}
console.log('All 33 assets verified present.');

const get = await client.send(new GetObjectCommand({ Bucket, Key: 'video-manifest.json' }));
const chunks = [];
for await (const c of get.Body) chunks.push(c);
const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
console.log(`Manifest before: version=${manifest.version}, keys=[${Object.keys(manifest).join(', ')}]`);

manifest.outfits = entries;
// Do NOT touch manifest.version: the mobile asset pipeline hard-asserts 'v1'.
manifest.version = 'v1';
manifest.outfitsUpdatedAt = new Date().toISOString();

await client.send(new PutObjectCommand({
  Bucket, Key: 'video-manifest.json',
  Body: JSON.stringify(manifest, null, 2),
  ContentType: 'application/json',
}));
console.log(`Manifest updated: version=${manifest.version}, outfits=${entries.length}`);
