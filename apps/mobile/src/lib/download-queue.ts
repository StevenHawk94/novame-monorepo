/**
 * Foreground-only R2 completion queue.
 *
 * Runtime inventory is intentionally limited to the folders that exist in
 * the production bucket: Announcements, Character Videos(-Android), Focus
 * Voice, Maps and Outfits. The retired Cards/Product Assets manifest fields
 * are never read here.
 *
 * Pages keep their existing cache-first behavior. This queue only warms the
 * same expo-image / file-system caches in the background, retries missing
 * files for as long as the app remains active, and reconstructs its work from
 * the manifest + local cache on every launch.
 */
import { AppState } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import {
  ensureOutfitVideoCached,
  fetchOutfitCatalog,
  getCachedOutfitCatalog,
  getCachedOutfitVideoUri,
  outfitAssetUrl,
  type OutfitDef,
} from './outfits';
import {
  fetchSceneCatalog,
  getCachedSceneCatalog,
  sceneAssetUrl,
  type SceneDef,
} from './scenes';
import { syncAllFocusVoiceAssets } from './focus-voice';

const MAX_CONCURRENCY = 2;
const ATTEMPT_TIMEOUT_MS = 30_000;
const MAX_RETRY_BACKOFF_MS = 5 * 60_000;

type QueueTask = {
  key: string;
  priority: number;
  status: 'queued' | 'active' | 'done';
  attempts: number;
  nextAttemptAt: number;
  isReady?: () => Promise<boolean>;
  run: () => Promise<boolean>;
};

const tasks = new Map<string, QueueTask>();
const listeners = new Set<() => void>();
let activeCount = 0;
let started = false;
let paused = AppState.currentState !== 'active';
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let revision = 0;

function notifyAssetReady(): void {
  revision += 1;
  // A fresh install can finish dozens of tiny thumbnails in quick succession.
  // Coalesce their UI invalidations so Home/Closet do not re-render once per
  // file while preserving immediate eventual repaint after failures recover.
  if (listeners.size === 0 || notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const listener of listeners) listener();
  }, 200);
}

export function subscribeR2AssetChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getR2AssetRevision(): number {
  return revision;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('R2 download attempt timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function scheduleRetryPump(): void {
  if (paused || retryTimer) return;
  const now = Date.now();
  let nextAt = Number.POSITIVE_INFINITY;
  for (const task of tasks.values()) {
    if (task.status === 'queued') nextAt = Math.min(nextAt, task.nextAttemptAt);
  }
  if (!Number.isFinite(nextAt)) return;
  const wait = Math.max(100, nextAt - now);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    pump();
  }, wait);
}

function pickNext(): QueueTask | null {
  const now = Date.now();
  let best: QueueTask | null = null;
  for (const task of tasks.values()) {
    if (task.status !== 'queued' || task.nextAttemptAt > now) continue;
    if (!best || task.priority < best.priority) best = task;
  }
  return best;
}

async function runTask(task: QueueTask): Promise<void> {
  try {
    if (task.isReady && await task.isReady()) {
      task.status = 'done';
      return;
    }
    const ok = await withTimeout(task.run(), ATTEMPT_TIMEOUT_MS);
    if (!ok) throw new Error('R2 asset was not cached');
    task.status = 'done';
    task.attempts = 0;
    notifyAssetReady();
  } catch {
    task.attempts += 1;
    const backoff = Math.min(
      1000 * 2 ** Math.min(task.attempts - 1, 8),
      MAX_RETRY_BACKOFF_MS,
    );
    task.nextAttemptAt = Date.now() + backoff;
    task.status = 'queued';
  }
}

function pump(): void {
  if (paused) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  while (activeCount < MAX_CONCURRENCY) {
    const task = pickNext();
    if (!task) break;
    task.status = 'active';
    activeCount += 1;
    void runTask(task).finally(() => {
      activeCount -= 1;
      pump();
    });
  }
  scheduleRetryPump();
}

function addTask(task: Omit<QueueTask, 'status' | 'attempts' | 'nextAttemptAt'>): void {
  const existing = tasks.get(task.key);
  if (existing) {
    existing.priority = Math.min(existing.priority, task.priority);
    if (existing.status !== 'active' && existing.status !== 'done') {
      existing.nextAttemptAt = Math.min(existing.nextAttemptAt, Date.now());
    }
    return;
  }
  tasks.set(task.key, {
    ...task,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: Date.now(),
  });
}

/** Add a static R2 image to expo-image's persistent disk cache. */
export function enqueueR2Image(url: string, priority = 20): void {
  if (!url.startsWith('https://media.novameapp.com/')) return;
  addTask({
    key: `image:${url}`,
    priority,
    isReady: async () => {
      try {
        return Boolean(await ExpoImage.getCachePathAsync(url));
      } catch {
        return false;
      }
    },
    run: async () => {
      try {
        return Boolean(await ExpoImage.prefetch(url, { cachePolicy: 'memory-disk' }));
      } catch {
        return false;
      }
    },
  });
  pump();
}

/** User-visible image failed or is about to be used: move it to the front. */
export function prioritizeR2Image(url: string): void {
  enqueueR2Image(url, -100);
  const task = tasks.get(`image:${url}`);
  if (task && task.status !== 'active') {
    task.status = 'queued';
    task.nextAttemptAt = Date.now();
  }
  pump();
}

function stageOutfit(outfit: OutfitDef): void {
  enqueueR2Image(outfitAssetUrl(outfit.thumb, outfit.assetVersion), 5);
  enqueueR2Image(outfitAssetUrl(outfit.bunny, outfit.assetVersion), 8);
  const version = outfit.assetVersion ?? 'unversioned';
  addTask({
    key: `outfit-video:${outfit.key}:${version}`,
    priority: 12,
    isReady: async () => Boolean(
      await getCachedOutfitVideoUri(outfit.key, outfit.assetVersion),
    ),
    run: async () => Boolean(await ensureOutfitVideoCached(outfit)),
  });
}

function stageScene(scene: SceneDef): void {
  enqueueR2Image(sceneAssetUrl(scene.thumb, scene.assetVersion), 5);
  enqueueR2Image(sceneAssetUrl(scene.image, scene.assetVersion), 15);
}

async function refreshRuntimeCatalogs(): Promise<boolean> {
  const [outfits, scenes] = await Promise.all([
    fetchOutfitCatalog(),
    fetchSceneCatalog(),
  ]);
  for (const outfit of outfits) stageOutfit(outfit);
  for (const scene of scenes) stageScene(scene);
  return outfits.length > 0 && scenes.length > 0;
}

function stageRuntimeInventory(): void {
  const cachedOutfits = getCachedOutfitCatalog();
  const cachedScenes = getCachedSceneCatalog();
  for (const outfit of cachedOutfits) stageOutfit(outfit);
  for (const scene of cachedScenes) stageScene(scene);

  addTask({
    key: 'catalogs:runtime',
    priority: -10,
    run: refreshRuntimeCatalogs,
  });

  // Focus Voice has no bucket manifest. Its sync function discovers the
  // sequential numbered tracks with cheap HEAD probes, then caches every one.
  addTask({
    key: 'focus-voice:all',
    priority: 30,
    run: syncAllFocusVoiceAssets,
  });
  pump();
}

/** Cold-start entry. Never blocks the splash or a page render. */
export function startDownloadQueue(): void {
  if (started) {
    resumeDownloadQueue();
    return;
  }
  started = true;
  paused = AppState.currentState !== 'active';
  stageRuntimeInventory();
  pump();
}

export function pauseDownloadQueue(): void {
  paused = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export function resumeDownloadQueue(): void {
  paused = false;
  if (!started) {
    startDownloadQueue();
    return;
  }
  for (const task of tasks.values()) {
    if (task.status === 'queued') task.nextAttemptAt = Math.min(task.nextAttemptAt, Date.now());
  }
  pump();
}

/** Reconcile after the tiny content-version pointer reports new assets. */
export function stageLatestManifest(): void {
  const catalogTask = tasks.get('catalogs:runtime');
  if (catalogTask && catalogTask.status !== 'active') {
    catalogTask.status = 'queued';
    catalogTask.attempts = 0;
    catalogTask.nextAttemptAt = Date.now();
  }
  stageRuntimeInventory();
  pump();
}

// Compatibility exports for retired callers. They now route into the same
// non-blocking foreground queue rather than maintaining a second cache policy.
export async function ensureP0Ready(): Promise<void> {
  startDownloadQueue();
}

export function enqueueP1(): void {
  stageLatestManifest();
}

export function bumpToFront(filename: string): void {
  const encoded = encodeURIComponent(filename);
  for (const task of tasks.values()) {
    if (task.key.includes(filename) || task.key.includes(encoded)) {
      task.priority = -100;
      if (task.status !== 'active') {
        task.status = 'queued';
        task.nextAttemptAt = Date.now();
      }
    }
  }
  pump();
}

export function resetDownloadQueue(): void {
  tasks.clear();
  activeCount = 0;
  started = false;
  paused = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = null;
}
