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

// P0 assets must eventually land, so a tier-0 download that stalls or fails
// is retried forever with capped exponential backoff. Each attempt is bounded
// by a timeout because File.downloadFileAsync has no cancellation: a stalled
// connection would otherwise hang the task in 'active' forever and never
// resolve the P0 gate. A timed-out native download is left to die on its own;
// the next attempt re-downloads and verifyCachedAsset's size check self-heals
// any partial/corrupt file, so no temp-file dance is needed.
const DOWNLOAD_ATTEMPT_TIMEOUT_MS = 12000;
const P0_RETRY_MAX_BACKOFF_MS = 30000;
// A P0 asset that fails this many attempts is marked failed and the gate
// opens anyway. Retry-forever assumed the manifest was always truthful; a
// deleted R2 object (2026-07-30 bucket re-org) proved a 404 can be permanent,
// and bricking every launch over a missing asset is worse than degrading.
const P0_MAX_ATTEMPTS = 4;

function withTimeout(p: Promise<unknown>, ms: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('download attempt timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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
  attempts?: number; // tier-0 retry count (undefined = 0). Tier 0 retries forever.
  nextAttemptAt?: number; // earliest ms a queued task may be picked (backoff gate; undefined/0 = now)
};

let tasks: DLTask[] = [];
let active = 0;
let started = false;
let p0Resolve: (() => void) | null = null;
let p0Promise: Promise<void> | null = null;

/** Returns the cached manifest, fetching+caching once if absent. */
async function ensureManifest(): Promise<AssetManifest | null> {
  const cached = getCachedManifest();
  if (cached) {
    // Lazy SWR: callers continue with cache immediately; the shared manifest
    // module decides whether its independent six-hour TTL needs a GET.
    void fetchManifestFromR2().catch(() => {});
    return cached;
  }
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
    const dl =
      t.kind === 'product' && t.product
        ? downloadProductAsset(baseUrl, t.product)
        : downloadAsset(baseUrl, t.filename);
    await withTimeout(dl, DOWNLOAD_ATTEMPT_TIMEOUT_MS);
    t.status = 'done';
  } catch {
    if (t.tier === 0) {
      // P0 retries with capped exponential backoff, but only up to
      // P0_MAX_ATTEMPTS: a permanently missing object (manifest drift) must
      // not hold the launch gate forever — mark failed and let the app
      // degrade (bundled fallbacks cover Home).
      t.attempts = (t.attempts ?? 0) + 1;
      if (t.attempts >= P0_MAX_ATTEMPTS) {
        console.warn(`[download-queue] P0 gave up after ${t.attempts} attempts: ${t.filename}`);
        t.status = 'failed';
      } else {
        const backoff = Math.min(
          1000 * 2 ** Math.min(t.attempts - 1, 5),
          P0_RETRY_MAX_BACKOFF_MS,
        );
        t.nextAttemptAt = Date.now() + backoff;
        t.status = 'queued';
        setTimeout(() => pump(baseUrl), backoff);
      }
    } else {
      t.status = 'failed'; // P1: non-blocking; retried on bumpToFront or next launch
    }
  }
}

function pickNext(): DLTask | null {
  let best: DLTask | null = null;
  const now = Date.now();
  for (const t of tasks) {
    if (t.status !== 'queued') continue;
    if ((t.nextAttemptAt ?? 0) > now) continue; // backoff: not yet eligible
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
export async function ensureP0Ready(homeVideoFilename?: string): Promise<void> {
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
  // Dynamically include the video the Home screen will actually play on
  // its first frame. For a returning user this is their current state's
  // clip (e.g. char1-outfitN-study.mp4) which lives in chars-video/ = P1;
  // promote it to P0 so the gate waits for it and Home plays it locally
  // (no CDN dependency, no failure placeholder). New users pass
  // char1-outfit1-hungry.mp4 which is already a root P0 asset.
  if (homeVideoFilename) {
    const v = m.videos.find((x) => x.filename === homeVideoFilename);
    if (v) {
      const existing = tasks.find((t) => t.key === v.filename);
      if (!existing) {
        tasks.push({
          key: v.filename, kind: 'video', filename: v.filename,
          dir: v.dir ?? '', size: v.size, tier: 0, seq: -1, status: 'queued',
        });
      } else if (existing.status === 'queued' || existing.status === 'failed') {
        existing.tier = 0;
        existing.seq = -1;
        existing.status = 'queued';
      }
    }
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

function taskRevision(t: DLTask): string {
  return [t.kind, t.filename, t.dir, t.size, t.product?.filename ?? ''].join('|');
}

/**
 * Reconcile an already-running queue with a newly downloaded manifest.
 * Existing valid downloads stay untouched; changed/new assets are queued in
 * the background. This is what makes a tiny launch-time version check useful
 * without blocking the native splash or re-downloading the whole catalog.
 */
export function stageLatestManifest(): void {
  const manifest = getCachedManifest();
  if (!manifest) return;

  let retryAfterActiveTask = false;
  for (const incoming of [...buildP0Tasks(manifest), ...buildP1Tasks(manifest)]) {
    const index = tasks.findIndex((task) => task.key === incoming.key);
    if (index < 0) {
      tasks.push(incoming);
      continue;
    }

    const existing = tasks[index];
    if (taskRevision(existing) !== taskRevision(incoming)) {
      if (existing.status === 'active') {
        retryAfterActiveTask = true;
        continue;
      }
      tasks[index] = incoming;
      continue;
    }

    if (
      (existing.status === 'failed' || existing.status === 'done')
      && !isTaskCached(incoming)
    ) {
      tasks[index] = incoming;
    }
  }

  pump(manifest.baseUrl);
  if (retryAfterActiveTask) {
    setTimeout(stageLatestManifest, DOWNLOAD_ATTEMPT_TIMEOUT_MS + 250);
  }
}

/** Reset all queue state (e.g. on sign-out). Does not delete cached files. */
export function resetDownloadQueue(): void {
  tasks = [];
  active = 0;
  started = false;
  p0Resolve = null;
  p0Promise = null;
}
