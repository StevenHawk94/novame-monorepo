import { storage } from './storage';
import { fetchMeStats } from './me-stats';
import { prefetchAppData } from './prefetch';

/**
 * Foreground refresh after a long background.
 *
 * v1 fanned out to eight caches. Six of them -- wisdoms, user-stats,
 * daily-tasks, character-state, wisdom-center, seek-questions -- described a
 * product that no longer exists. Two remain, and Phase B replaces this module
 * wholesale: createResource() declares its own invalidation triggers, so
 * nobody has to remember to add a line here when a cache is born.
 *
 * The 30-minute threshold is the concurrency lock. Two foreground transitions
 * inside that window cannot both pass shouldRefreshAll(), so there is nothing
 * left for a mutex to guard.
 *
 * The timestamp is stamped even when a refresh fails, or a user on a bad train
 * connection re-fires the whole batch on every background/foreground flicker.
 */
const LAST_REFRESH_KEY = 'novame_last_global_refresh_ms';
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/** Synchronous -- MMKV reads are sync, so this is safe inside an AppState handler. */
export function shouldRefreshAll(): boolean {
  const raw = storage.getString(LAST_REFRESH_KEY);
  const last = raw ? Number(raw) : 0;
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last > STALE_THRESHOLD_MS;
}

/** Also called at the end of cold-start prewarm, so the first foreground tick skips. */
export function markRefreshedNow(): void {
  storage.set(LAST_REFRESH_KEY, String(Date.now()));
}

/** Fire-and-forget safe: never throws. */
export async function refreshAllCaches(userId: string): Promise<void> {
  // Foregrounding is a valid lazy trigger, not a command to invalidate every
  // cache. Each resource below applies its own TTL and singleflight policy.
  // This keeps the UI cache-first and avoids refreshing low-frequency data
  // merely because a high-frequency resource became stale.
  prefetchAppData();
  await Promise.allSettled([fetchMeStats(userId)]);
  markRefreshedNow();
}
