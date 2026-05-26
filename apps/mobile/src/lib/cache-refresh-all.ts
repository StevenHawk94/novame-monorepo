/**
 * Global cache refresh helper -- Stage 6 Wisdom Insight 3-bug fix
 * series, Gap A (AppState foreground refresh).
 *
 * Purpose
 * -------
 * When the user backgrounds the app and returns 30+ minutes later,
 * every SWR cache they pulled before backgrounding is potentially
 * stale (their EXP may have changed via tasks they completed on
 * web, leaderboard rank may have shifted, daily_tasks may have
 * rolled into a new day, etc). This module gives _layout.tsx's
 * AppState listener a single one-call entry point that:
 *
 *   1. Checks a 30-minute staleness threshold (shouldRefreshAll).
 *   2. If stale, refreshes all 8 publish-affected SWR caches in
 *      parallel via Promise.allSettled (refreshAllCaches).
 *   3. Stamps the refresh timestamp regardless of individual
 *      success/failure (per Q-16.1 = A decision; this prevents
 *      bad-network retry storms across rapid background/foreground
 *      cycles).
 *
 * Why a separate module
 * ---------------------
 * record.tsx's publish path runs essentially the same Promise.allSettled
 * batch for its own reasons (publish mutations make those caches
 * stale immediately). The two batches are semantically distinct:
 *   - record.tsx batch  = "this publish event invalidated these caches"
 *   - this module batch = "the user backgrounded for >30min; everything
 *                          we know about is potentially stale"
 * Keeping them in separate call sites preserves that semantic split.
 * If a future cache is added that only one of the two scenarios
 * affects, it can be added to one batch without the other.
 *
 * Why no concurrent-call lock
 * ---------------------------
 * Per Q-16.2 = I decision: the 30-minute threshold IS the lock.
 * Two AppState 'active' transitions within 30 minutes are filtered
 * out by shouldRefreshAll, so duplicate refreshAllCaches calls are
 * not a meaningful concern.
 *
 * Why cold-start does NOT trigger refreshAllCaches
 * ------------------------------------------------
 * Per Q-16.3 = P decision: _layout.tsx cold-start prewarm sets the
 * timestamp via markRefreshedNow(), so the first AppState 'active'
 * tick after cold start sees a fresh timestamp and skips. This is
 * correct because cold-start prewarm already fetches the 4 most
 * UI-critical caches (character-state / subscription / me-stats /
 * app-config); the remaining 4 are not on the cold-start critical
 * path and will be filled by the user's first tab focus regardless.
 */

import { storage } from './storage';
import { refreshWisdoms } from './wisdoms-api';
import { refreshUserStats } from './user-stats-api';
import { refreshMeStats } from './me-stats';
import { refreshDailyTasks } from './daily-tasks-api';
import { refreshLeaderboard } from './leaderboard-api';
import { refreshCharacterState } from './character-state';
import { refreshWisdomCenter } from './wisdom-center-api';
import { refreshSeekQuestions } from './seek-questions-cache';

/**
 * MMKV key holding the millisecond timestamp of the last successful
 * call to refreshAllCaches (or cold-start prewarm via
 * markRefreshedNow). String-encoded number for consistency with
 * the rest of the codebase's storage usage (the project uses
 * storage.getString + JSON / Number parsing exclusively; MMKV v4's
 * getNumber API is available but never used here).
 */
const LAST_REFRESH_KEY = 'novame_last_global_refresh_ms';

/**
 * 30-minute staleness threshold. If the gap between Date.now() and
 * the cached timestamp exceeds this, refreshAllCaches is allowed
 * to run. Matches the Gap A decision.
 */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Returns true if the cached timestamp is older than 30 minutes
 * (or absent entirely -- first launch never has it).
 *
 * Synchronous: MMKV reads are sync, so this is safe to call inside
 * AppState change handlers without await.
 */
export function shouldRefreshAll(): boolean {
  const raw = storage.getString(LAST_REFRESH_KEY);
  const last = raw ? Number(raw) : 0;
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last > STALE_THRESHOLD_MS;
}

/**
 * Writes the current timestamp to MMKV. Called:
 *   - At the end of refreshAllCaches (regardless of individual
 *     refresh success/failure -- per Q-16.1 = A).
 *   - At the end of cold-start prewarm in _layout.tsx (per
 *     Q-16.3 = P, so the next AppState 'active' won't re-refresh
 *     within 30 minutes of cold start).
 */
export function markRefreshedNow(): void {
  storage.set(LAST_REFRESH_KEY, String(Date.now()));
}

/**
 * Fires all 8 publish-affected refresh* helpers in parallel via
 * Promise.allSettled, then stamps the timestamp. Fire-and-forget
 * safe: never throws. Each refresh* helper already has its own
 * try/catch + console.warn for individual failures.
 *
 * The 8 caches:
 *   - wisdoms         (My Logs row list)
 *   - user-stats      (Assets totals + typesCollected input)
 *   - me-stats        (Me page numbers)
 *   - daily-tasks     (Growth task list -- includes daily_love
 *                      rollover detection at the server)
 *   - leaderboard     (Ranking)
 *   - character-state (Home EXP / WP / level)
 *   - wisdom-center   (Growth Center / wisdom-insight aspireScores)
 *   - seek-questions  (Discover feed default unfiltered slot)
 */
export async function refreshAllCaches(userId: string): Promise<void> {
  await Promise.allSettled([
    refreshWisdoms(userId),
    refreshUserStats(userId),
    refreshMeStats(userId),
    refreshDailyTasks(userId),
    refreshLeaderboard(),
    refreshCharacterState(userId),
    refreshWisdomCenter(userId),
    refreshSeekQuestions(),
  ]);
  markRefreshedNow();
}
