#!/usr/bin/env node
/** Upload and verify the immutable base item-icon catalog in Cloudflare R2. */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(ADMIN, '../..');
const ENV_PATH = join(ADMIN, '.env.local');
const INVENTORY_PATH = join(ROOT, 'tools/item-source/memory-items/r2-base-icons-manifest.json');
const EACH_DIR = join(ROOT, 'tools/item-source/memory-items/each');
const CONCURRENCY = 12;

function loadEnv(path, overwrite = false, allowedKeys = null) {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals < 1) continue;
    const key = trimmed.slice(0, equals).trim();
    if (allowedKeys && !allowedKeys.has(key)) continue;
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (overwrite || !process.env[key]) process.env[key] = value;
  }
}

const explicitEnvArg = process.argv.find((arg) => arg.startsWith('--env='));
const explicitEnvPath = explicitEnvArg ? resolve(process.cwd(), explicitEnvArg.slice('--env='.length)) : null;
loadEnv(ENV_PATH);
if (explicitEnvPath) {
  // Local workspaces can keep a stale admin copy of a rotated credential.
  // Import only credentials from the explicit file: bucket/public URL remain
  // those owned by the admin media catalog and cannot be redirected silently.
  loadEnv(explicitEnvPath, true, new Set(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']));
}
const { r2HeadObject, r2PutObject } = await import('../src/lib/r2-client.js');
const manifest = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length !== manifest.count) {
  throw new Error('Invalid base icon inventory. Run tools/build-item-icon-assets.mjs first.');
}
const upload = process.argv.includes('--upload');
let cursor = 0;
let uploaded = 0;
let reused = 0;
let failed = 0;

async function syncEntry(entry) {
  const existing = await r2HeadObject(entry.key);
  if (existing?.size === entry.bytes) {
    reused += 1;
    return;
  }
  if (!upload) throw new Error(`${entry.key} is missing or has the wrong size.`);
  const body = readFileSync(join(EACH_DIR, basename(entry.key)));
  await r2PutObject({
    key: entry.key,
    body,
    contentType: 'image/webp',
    cacheControl: 'public, max-age=31536000, immutable',
  });
  const verified = await r2HeadObject(entry.key);
  if (verified?.size !== entry.bytes) throw new Error(`${entry.key} failed post-upload verification.`);
  uploaded += 1;
}

async function worker() {
  for (;;) {
    const index = cursor++;
    if (index >= manifest.entries.length) return;
    try {
      await syncEntry(manifest.entries[index]);
    } catch (error) {
      failed += 1;
      console.error(error instanceof Error ? error.message : String(error));
    }
    const complete = uploaded + reused + failed;
    if (complete % 250 === 0 || complete === manifest.entries.length) {
      console.log(`checked ${complete}/${manifest.entries.length}; uploaded=${uploaded}, reused=${reused}, failed=${failed}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
if (failed) throw new Error(`${failed} base icons failed R2 synchronization.`);
if (upload) {
  const publicManifest = {
    ...manifest,
    entries: manifest.entries.map(({ itemId, key, bytes, sha256 }) => ({ itemId, key, bytes, sha256 })),
  };
  await r2PutObject({
    key: `Items/base-icons/${manifest.catalogVersion}/manifest.json`,
    body: new TextEncoder().encode(JSON.stringify(publicManifest)),
    contentType: 'application/json',
    cacheControl: 'public, max-age=31536000, immutable',
  });
}
console.log(`Base icon catalog verified: ${manifest.count} objects, ${manifest.totalBytes} bytes.`);
