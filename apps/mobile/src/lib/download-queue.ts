/**
 * download-queue.ts — Priority asset download queue (P1).
 *
 * Tiers:
 *   P0 (tier 0): bucket-root assets (dir === ''). Must be local before
 *     the Home screen renders for a returning (session) user. The
 *     gate in app/index.tsx awaits ensureP0Ready().
 *   P1 (tier 1): folder assets, downloaded in background after P0.
 *     Order: 'cards art' (0) -> 'chars-video' (1) -> 'product details' (2).
 *   P2: anything not enqueued — pulled on demand via bumpToFront().
 *
 * Concurrency capped at MAX_CONCURRENCY (no scattered parallelism).
 * Reuses asset-cache primitives:
 *   - downloadAsset(baseUrl, filename) for video/card/extra (bare name).
 *   - downloadProductAsset(baseUrl, entry) for productAssets (versioned name).
 *   - verifyCachedAsset / getCachedAssetUri / productCacheFilename for
 *     idempotent "already cached" skips.
 *
 * Manifest timing: ensureManifest() awaits a fresh fetch if the cache
 * is empty, so the queue and the P0 gate never race the cold-start
 * prewarm's async manifest refresh.
 */
import {
  downloadAsset,
  downloadProductAsset,
  fetchManifestFromR2,
  getCachedAssetUri,
  getCachedManifest,
  productCacheFilename,
  setCachedManifest,
  verifyCachedAsset,
} from './asset-cache';
import type { AssetManifest, ProductAssetManifestEntry } from './asset-types';

const MAX_CONCURRENCY = 3;

// P1 folder download order (Q-P1: cards art -> chars-video -> product details).
const P1_DIR_SEQ: Record<string, number> = {
  'cards art': 0,
  'chars-video': 1,
  'product details': 2,
};

// Extra P0 assets not present in the manifest. Intentionally empty:
// cards-background.webp is consumed via R2 URL + expo-image cache (not
// asset-cache), is not a Home asset, and record.tsx already
// ExpoImage.prefetch()es it before the insight screen. Left as a hook
// for any future manifest-absent P0 asset that IS consumed via asset-cache.
const EXTRA_P0_FILENAMES: readonly string[] = [];

type AssetKind = 'video' | 'card' | 'product' | 'extra';

type DLTask = {
  key: string; // dedupe key: product uses id, others use filename
  kind: AssetKind;
  filename: string; // bare name (cache + verify name for video/card/extra)
  dir: string;
  size: number; // 0 for extra (no size check)
  product?: ProductAssetManifestEntry; // present when kind === 'product'
  tier: 0 | 1;
  seq: number; // order within tier (lower = earlier)
  status: 'queued' | 'active' | 'done' | 'failed';
};

let tasks: DLTask[] = [];
let active = 0;
let started = false;
let p0Resolve: (() => void) | null = null;
let p0Promise: Promise<void> | null = null;

/** Returns the cached manifest, fetching+caching once if absent. */
async function ensureManifest(): Promise<AssetManifest | null> {
  const cached = getCachedManifest();
  if (cached) return cached;
  try {
    const fresh = await fetchManifestFromR2();
    setCachedManifest(fresh);
    return fresh;
  } catch {
    return null;
  }
}

function isTaskCached(t: DLTask): boolean {
  if (t.kind === 'product' && t.product) {
    return getCachedAssetUri(productCacheFilename(t.product)) !== null;
  }
  if (t.kind === 'extra') {
    return getCachedAssetUri(t.filename) !== null; // no size, existence only
  }
  // video / card: size-verified (mismatch deletes the file -> false).
  return verifyCachedAsset(t.filename, t.size);
}

function maybeResolveP0(): void {
  if (!p0Resolve) return;
  const left = tasks.some(
    (t) => t.tier === 0 && (t.status === 'queued' || t.status === 'active'),
  );
  if (!left) {
    p0Resolve();
    p0Resolve = null;
  }
}

async function runTask(t: DLTask, baseUrl: string): Promise<void> {
  if (isTaskCached(t)) {
    t.status = 'done';
    return;
  }
  try {
    if (t.kind === 'product' && t.product) {
      await downloadProductAsset(baseUrl, t.product);
    } else {
      await downloadAsset(baseUrl, t.filename);
    }
    t.status = 'done';
  } catch {
    t.status = 'failed'; // non-blocking; retried on bumpToFront or next launch
  }
}

function pickNext(): DLTask | null {
  let best: DLTask | null = null;
  for (const t of tasks) {
    if (t.status !== 'queued') continue;
    if (!best) {
      best = t;
      continue;
    }
    if (t.tier !== best.tier) {
      if (t.tier < best.tier) best = t;
      continue;
    }
    if (t.seq < best.seq) best = t;
  }
  return best;
}

function pump(baseUrl: string): void {
  while (active < MAX_CONCURRENCY) {
    const next = pickNext();
    if (!next) break;
    next.status = 'active';
    active += 1;
    void runTask(next, baseUrl).finally(() => {
      active -= 1;
      maybeResolveP0();
      pump(baseUrl);
    });
  }
  maybeResolveP0();
}

function hasTask(key: string): boolean {
  return tasks.some((t) => t.key === key);
}

function buildP0Tasks(m: AssetManifest): DLTask[] {
  const out: DLTask[] = [];
  const isRoot = (dir?: string) => (dir ?? '') === '';
  m.videos
    .filter((v) => isRoot(v.dir))
    .forEach((v) =>
      out.push({ key: v.filename, kind: 'video', filename: v.filename, dir: '', size: v.size, tier: 0, seq: 0, status: 'queued' }),
    );
  m.cards
    .filter((c) => isRoot(c.dir))
    .forEach((c) =>
      out.push({ key: c.filename, kind: 'card', filename: c.filename, dir: '', size: c.size, tier: 0, seq: 0, status: 'queued' }),
    );
  (m.productAssets ?? [])
    .filter((p) => isRoot(p.dir))
    .forEach((p) =>
      out.push({ key: p.id, kind: 'product', filename: p.filename, dir: '', size: p.size, product: p, tier: 0, seq: 0, status: 'queued' }),
    );
  EXTRA_P0_FILENAMES.forEach((fn) =>
    out.push({ key: fn, kind: 'extra', filename: fn, dir: '', size: 0, tier: 0, seq: 0, status: 'queued' }),
  );
  return out;
}

function buildP1Tasks(m: AssetManifest): DLTask[] {
  const out: DLTask[] = [];
  const seqOf = (dir?: string) => P1_DIR_SEQ[dir ?? ''] ?? 99;
  m.videos
    .filter((v) => (v.dir ?? '') !== '')
    .forEach((v) =>
      out.push({ key: v.filename, kind: 'video', filename: v.filename, dir: v.dir ?? '', size: v.size, tier: 1, seq: seqOf(v.dir), status: 'queued' }),
    );
  m.cards
    .filter((c) => (c.dir ?? '') !== '')
    .forEach((c) =>
      out.push({ key: c.filename, kind: 'card', filename: c.filename, dir: c.dir ?? '', size: c.size, tier: 1, seq: seqOf(c.dir), status: 'queued' }),
    );
  (m.productAssets ?? [])
    .filter((p) => (p.dir ?? '') !== '')
    .forEach((p) =>
      out.push({ key: p.id, kind: 'product', filename: p.filename, dir: p.dir ?? '', size: p.size, product: p, tier: 1, seq: seqOf(p.dir), status: 'queued' }),
    );
  return out;
}

/** Enqueue all P0 assets; resolves when every P0 task is done/skipped. */
export async function ensureP0Ready(): Promise<void> {
  const m = await ensureManifest();
  if (!m) return; // no manifest: can't download; gate timeout + CDN fallback cover it
  if (!p0Promise) {
    p0Promise = new Promise<void>((res) => {
      p0Resolve = res;
    });
  }
  for (const t of buildP0Tasks(m)) {
    if (!hasTask(t.key)) tasks.push(t);
  }
  pump(m.baseUrl);
  maybeResolveP0();
  return p0Promise;
}

/** Enqueue all P1 assets (background, not awaited). Call after P0. */
export function enqueueP1(): void {
  const m = getCachedManifest();
  if (!m) return;
  for (const t of buildP1Tasks(m)) {
    if (!hasTask(t.key)) tasks.push(t);
  }
  pump(m.baseUrl);
}

/**
 * Action-triggered priority bump. filename = bare name (video/card/extra)
 * or a productAsset's filename. Re-queues queued/failed tasks at top
 * priority; creates a top-priority task if not enqueued (P2 on-demand).
 */
export function bumpToFront(filename: string): void {
  const m = getCachedManifest();
  if (!m) return;
  const existing = tasks.find((t) => t.filename === filename || t.key === filename);
  if (existing) {
    if (existing.status === 'queued' || existing.status === 'failed') {
      existing.tier = 0;
      existing.seq = -1;
      existing.status = 'queued';
    }
    pump(m.baseUrl);
    return;
  }
  const v = m.videos.find((x) => x.filename === filename);
  const c = m.cards.find((x) => x.filename === filename);
  const p = (m.productAssets ?? []).find((x) => x.filename === filename);
  let t: DLTask;
  if (v) t = { key: v.filename, kind: 'video', filename, dir: v.dir ?? '', size: v.size, tier: 0, seq: -1, status: 'queued' };
  else if (c) t = { key: c.filename, kind: 'card', filename, dir: c.dir ?? '', size: c.size, tier: 0, seq: -1, status: 'queued' };
  else if (p) t = { key: p.id, kind: 'product', filename, dir: p.dir ?? '', size: p.size, product: p, tier: 0, seq: -1, status: 'queued' };
  else t = { key: filename, kind: 'extra', filename, dir: '', size: 0, tier: 0, seq: -1, status: 'queued' };
  tasks.push(t);
  pump(m.baseUrl);
}

/** Cold-start entry: start P0, then chain P1 in the background. Idempotent. */
export function startDownloadQueue(): void {
  if (started) return;
  started = true;
  void ensureP0Ready().then(() => enqueueP1());
}

/** Reset all queue state (e.g. on sign-out). Does not delete cached files. */
export function resetDownloadQueue(): void {
  tasks = [];
  active = 0;
  started = false;
  p0Resolve = null;
  p0Promise = null;
}
