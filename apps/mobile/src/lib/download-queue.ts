/**
 * Foreground-only R2 completion queue.
 *
 * Android keeps the 5,439 bundled item images as its offline baseline, then
 * fills the confirmed R2 P0 set into file caches with one foreground/idle
 * worker. Visible work can move ahead of that worker. iOS retains the existing
 * warm-up path unchanged.
 *
 * Pages keep their existing cache-first behavior. Android warm-up is disk-only
 * with bounded backoff; it never pre-decodes the background image library or
 * opens parallel download lanes.
 */
import { AppState, InteractionManager, Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import {
  ensureOutfitVideoCached,
  fetchOutfitCatalog,
  getCachedOutfitCatalog,
  getCachedOutfitVideoUri,
  getEquippedOutfitKey,
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
import { getCachedRemoteItemManifest, remoteItemAssetUrl } from './item-manifest-cache';
import { getSelectedScene } from './cosmetics-store';
import {
  ensureAndroidR2FileCached,
  getAndroidR2CachedUri,
  isAndroidR2FileCached,
} from './android-r2-file-cache';
import type { RemoteItemManifest } from '@novame/engine';

const IS_ANDROID = Platform.OS === 'android';
const MAX_CONCURRENCY = IS_ANDROID ? 1 : 2;
const ATTEMPT_TIMEOUT_MS = 30_000;
const MAX_RETRY_BACKOFF_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

// Lower number = earlier. Explicit visible work and announcements may outrank
// the confirmed P0 order. Equal-priority tasks retain manifest insertion order.
const PRIORITY = {
  urgent: IS_ANDROID ? -300 : -100,
  catalog: -40,
  outfitThumb: 0,
  sceneThumb: 5,
  outfitPreview: 10,
  itemIcon: 15,
  sceneFull: 20,
  outfitAnimation: 25,
  focusVoice: 40,
} as const;

type QueueTask = {
  key: string;
  priority: number;
  status: 'queued' | 'active' | 'done';
  attempts: number;
  nextAttemptAt: number;
  isReady?: () => Promise<boolean>;
  run: () => Promise<boolean>;
  /** null keeps the single native file request owned until it settles. */
  timeoutMs?: number | null;
  requiresAndroidUi?: boolean;
  requiresAndroidIdle?: boolean;
};

const tasks = new Map<string, QueueTask>();
const taskWaiters = new Map<string, Set<(ok: boolean) => void>>();
const listeners = new Set<() => void>();
let activeCount = 0;
let started = false;
let paused = AppState.currentState !== 'active';
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let revision = 0;
let androidUiReady = false;
let androidIdlePermit = false;
let androidIdleHandle: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

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

function settleTask(key: string, ok: boolean): void {
  const waiting = taskWaiters.get(key);
  if (!waiting) return;
  taskWaiters.delete(key);
  for (const resolve of waiting) resolve(ok);
}

function waitForTask(key: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const waiting = taskWaiters.get(key) ?? new Set<(ok: boolean) => void>();
    waiting.add(resolve);
    taskWaiters.set(key, waiting);
  });
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
    if (task.status !== 'queued') continue;
    if (IS_ANDROID && task.requiresAndroidUi && !androidUiReady) continue;
    if (
      IS_ANDROID && task.requiresAndroidIdle && !androidIdlePermit
      && task.nextAttemptAt <= now
    ) continue;
    nextAt = Math.min(nextAt, task.nextAttemptAt);
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
    if (IS_ANDROID && task.requiresAndroidUi && !androidUiReady) continue;
    if (IS_ANDROID && task.requiresAndroidIdle && !androidIdlePermit) continue;
    if (!best || task.priority < best.priority) best = task;
  }
  if (!IS_ANDROID && best?.key === 'focus-voice:all') {
    const hasEarlierWork = [...tasks.values()].some((task) =>
      task.key !== best?.key && task.priority < PRIORITY.focusVoice
      && (task.status === 'active' || (task.status === 'queued' && task.nextAttemptAt <= now)));
    if (hasEarlierWork) return null;
  }
  return best;
}

function scheduleAndroidIdlePump(): void {
  if (
    !IS_ANDROID || paused || !androidUiReady || androidIdlePermit || androidIdleHandle
    || activeCount >= MAX_CONCURRENCY
  ) return;
  const hasIdleWork = [...tasks.values()].some((task) =>
    task.status === 'queued' && task.requiresAndroidIdle && task.nextAttemptAt <= Date.now());
  if (!hasIdleWork) return;
  androidIdleHandle = InteractionManager.runAfterInteractions(() => {
    androidIdleHandle = null;
    if (paused || !androidUiReady) return;
    androidIdlePermit = true;
    pump();
  });
}

async function runTask(task: QueueTask): Promise<void> {
  try {
    if (task.isReady && await task.isReady()) {
      if (IS_ANDROID) tasks.delete(task.key);
      else task.status = 'done';
      settleTask(task.key, true);
      return;
    }
    const work = task.run();
    const ok = task.timeoutMs === null
      ? await work
      : await withTimeout(work, task.timeoutMs ?? ATTEMPT_TIMEOUT_MS);
    if (!ok) throw new Error('R2 asset was not cached');
    if (IS_ANDROID) tasks.delete(task.key);
    else {
      task.status = 'done';
      task.attempts = 0;
    }
    // Background Android P0 files are intentionally silent: no mounted screen
    // needs them yet, so repainting Home after every file would create jank.
    // A promoted/visible task (or the tiny catalog) still publishes promptly.
    if (!IS_ANDROID || task.priority < 0) notifyAssetReady();
    settleTask(task.key, true);
  } catch {
    task.attempts += 1;
    if (IS_ANDROID && task.attempts >= MAX_ATTEMPTS) {
      // P0 is eventual, but a bad/offline URL must not create a hot retry loop.
      // Start a fresh bounded retry cycle after five minutes; foregrounding or
      // an explicit visible request brings it forward sooner.
      if (task.requiresAndroidIdle) {
        task.status = 'queued';
        task.attempts = 0;
        task.nextAttemptAt = Date.now() + MAX_RETRY_BACKOFF_MS;
      } else {
        tasks.delete(task.key);
        settleTask(task.key, false);
      }
      return;
    }
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
    if (IS_ANDROID && task.requiresAndroidIdle) androidIdlePermit = false;
    activeCount += 1;
    void runTask(task).finally(() => {
      activeCount -= 1;
      pump();
    });
  }
  scheduleRetryPump();
  scheduleAndroidIdlePump();
}

function addTask(task: Omit<QueueTask, 'status' | 'attempts' | 'nextAttemptAt'>): void {
  const existing = tasks.get(task.key);
  if (existing) {
    existing.priority = Math.min(existing.priority, task.priority);
    existing.requiresAndroidIdle = Boolean(existing.requiresAndroidIdle && task.requiresAndroidIdle);
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
        if (IS_ANDROID) return isAndroidR2FileCached(url);
        const cachePath = await ExpoImage.getCachePathAsync(url);
        return Boolean(cachePath);
      } catch {
        return false;
      }
    },
    run: async () => {
      try {
        if (IS_ANDROID) return Boolean(await ensureAndroidR2FileCached(url));
        return Boolean(await ExpoImage.prefetch(url, { cachePolicy: 'memory-disk' }));
      } catch {
        return false;
      }
    },
    requiresAndroidUi: IS_ANDROID,
    requiresAndroidIdle: IS_ANDROID && priority >= 0,
    timeoutMs: IS_ANDROID ? null : undefined,
  });
  pump();
}

/** Await a user-visible Android file while preserving the single queue lane. */
export function ensurePriorityR2Image(
  url: string,
  priority: number = PRIORITY.urgent,
): Promise<string | null> {
  if (!IS_ANDROID) {
    return ExpoImage.prefetch(url, { cachePolicy: 'memory-disk' })
      .then((ok) => ok ? url : null)
      .catch(() => null);
  }
  return (async () => {
    if (!url.startsWith('https://media.novameapp.com/')) return null;
    if (await isAndroidR2FileCached(url)) return getAndroidR2CachedUri(url);
    enqueueR2Image(url, priority);
    const key = `image:${url}`;
    const ok = await waitForTask(key);
    return ok ? getAndroidR2CachedUri(url) : null;
  })();
}

/** User-visible image failed or is about to be used: move it to the front. */
export function prioritizeR2Image(url: string): void {
  enqueueR2Image(url, PRIORITY.urgent);
  const task = tasks.get(`image:${url}`);
  if (task && task.status !== 'active') {
    task.status = 'queued';
    if (IS_ANDROID) task.attempts = 0;
    task.nextAttemptAt = Date.now();
  }
  pump();
}

function addOutfitVideoTask(
  outfit: OutfitDef,
  priority: number,
  requiresAndroidIdle = false,
): string {
  const version = outfit.assetVersion ?? 'unversioned';
  const key = `outfit-video:${outfit.key}:${version}`;
  addTask({
    key,
    priority,
    isReady: async () => Boolean(await getCachedOutfitVideoUri(outfit.key, outfit.assetVersion)),
    run: async () => Boolean(await ensureOutfitVideoCached(outfit)),
    requiresAndroidUi: IS_ANDROID,
    requiresAndroidIdle: IS_ANDROID && requiresAndroidIdle,
    timeoutMs: IS_ANDROID ? null : undefined,
  });
  return key;
}

/** Await the currently requested outfit without opening a second download lane. */
export async function ensurePriorityOutfitVideo(outfit: OutfitDef): Promise<string | null> {
  if (!IS_ANDROID) return ensureOutfitVideoCached(outfit);
  const cached = await getCachedOutfitVideoUri(outfit.key, outfit.assetVersion);
  if (cached) return cached;
  const key = addOutfitVideoTask(outfit, PRIORITY.urgent, false);
  pump();
  const ok = await waitForTask(key);
  return ok ? getCachedOutfitVideoUri(outfit.key, outfit.assetVersion) : null;
}

function stageOutfit(outfit: OutfitDef): void {
  enqueueR2Image(outfitAssetUrl(outfit.thumb, outfit.assetVersion), PRIORITY.outfitThumb);
  enqueueR2Image(outfitAssetUrl(outfit.bunny, outfit.assetVersion), PRIORITY.outfitPreview);
  addOutfitVideoTask(outfit, PRIORITY.outfitAnimation);
}

function stageAndroidP0(outfits: OutfitDef[], scenes: SceneDef[]): void {
  if (!IS_ANDROID) return;
  const equipped = getEquippedOutfitKey();
  const selectedScene = getSelectedScene();

  // Visible Home resources outrank announcements and the background library.
  const currentOutfit = outfits.find((outfit) => outfit.key === equipped);
  if (currentOutfit) {
    addOutfitVideoTask(currentOutfit, PRIORITY.urgent, false);
  }
  const currentScene = scenes.find((scene) => scene.key === selectedScene);
  if (currentScene) {
    enqueueR2Image(sceneAssetUrl(currentScene.image, currentScene.assetVersion), PRIORITY.urgent);
  }

  // Confirmed P0 order: Outfit thumbs → Map thumbs → worn previews → full
  // Maps → Android outfit animations → Focus Voice. Equal-priority insertion
  // order follows video-manifest.json.
  for (const outfit of outfits) {
    enqueueR2Image(outfitAssetUrl(outfit.thumb, outfit.assetVersion), PRIORITY.outfitThumb);
  }
  for (const scene of scenes) {
    enqueueR2Image(sceneAssetUrl(scene.thumb, scene.assetVersion), PRIORITY.sceneThumb);
  }
  for (const outfit of outfits) {
    enqueueR2Image(outfitAssetUrl(outfit.bunny, outfit.assetVersion), PRIORITY.outfitPreview);
  }
  for (const scene of scenes) {
    enqueueR2Image(sceneAssetUrl(scene.image, scene.assetVersion), PRIORITY.sceneFull);
  }
  for (const outfit of outfits) {
    addOutfitVideoTask(outfit, PRIORITY.outfitAnimation, true);
  }
  addTask({
    key: 'focus-voice:all',
    priority: PRIORITY.focusVoice,
    run: () => syncAllFocusVoiceAssets({
      shouldContinue: () => !paused && ![...tasks.values()].some((task) =>
        task.status === 'queued' && task.priority < PRIORITY.focusVoice),
    }),
    requiresAndroidUi: true,
    requiresAndroidIdle: true,
    timeoutMs: null,
  });
}

function stageScene(scene: SceneDef): void {
  enqueueR2Image(sceneAssetUrl(scene.thumb, scene.assetVersion), PRIORITY.sceneThumb);
  enqueueR2Image(sceneAssetUrl(scene.image, scene.assetVersion), PRIORITY.sceneFull);
}

export function stageRemoteItemImages(
  manifest?: RemoteItemManifest | null,
): void {
  if (IS_ANDROID) {
    // New remote icons are queued by ItemSprite when visible on Android.
    return;
  }
  const resolvedManifest = manifest === undefined ? getCachedRemoteItemManifest() : manifest;
  for (const item of resolvedManifest?.items ?? []) {
    enqueueR2Image(remoteItemAssetUrl(item.imageKey, item.assetVersion), PRIORITY.itemIcon);
  }
}

async function refreshRuntimeCatalogs(): Promise<boolean> {
  const [outfits, scenes] = await Promise.all([
    fetchOutfitCatalog(),
    fetchSceneCatalog(),
  ]);
  if (!IS_ANDROID) {
    for (const outfit of outfits) stageOutfit(outfit);
    for (const scene of scenes) stageScene(scene);
    addTask({
      key: 'focus-voice:all',
      priority: PRIORITY.focusVoice,
      run: syncAllFocusVoiceAssets,
    });
  } else {
    stageAndroidP0(outfits, scenes);
  }
  return outfits.length > 0 && scenes.length > 0;
}

function stageRuntimeInventory(): void {
  if (!IS_ANDROID) {
    for (const outfit of getCachedOutfitCatalog()) stageOutfit(outfit);
    for (const scene of getCachedSceneCatalog()) stageScene(scene);
    stageRemoteItemImages();
  } else {
    const outfits = getCachedOutfitCatalog();
    const scenes = getCachedSceneCatalog();
    if (outfits.length > 0 || scenes.length > 0) stageAndroidP0(outfits, scenes);
  }
  addTask({
    key: 'catalogs:runtime',
    priority: PRIORITY.catalog,
    run: refreshRuntimeCatalogs,
    timeoutMs: IS_ANDROID ? 8_000 : undefined,
    requiresAndroidUi: IS_ANDROID,
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
  androidIdlePermit = false;
  androidIdleHandle?.cancel();
  androidIdleHandle = null;
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
    if (task.status === 'queued') {
      task.nextAttemptAt = Math.min(task.nextAttemptAt, Date.now());
    }
  }
  pump();
}

/** Called only after Android's first bundled destination has painted. */
export function markAndroidP0UiReady(): void {
  if (!IS_ANDROID || androidUiReady) return;
  androidUiReady = true;
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
      task.priority = PRIORITY.urgent;
      if (task.status !== 'active') {
        task.status = 'queued';
        task.nextAttemptAt = Date.now();
      }
    }
  }
  pump();
}

export function resetDownloadQueue(): void {
  for (const key of taskWaiters.keys()) settleTask(key, false);
  tasks.clear();
  activeCount = 0;
  started = false;
  paused = true;
  androidUiReady = false;
  androidIdlePermit = false;
  androidIdleHandle?.cancel();
  androidIdleHandle = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = null;
}
