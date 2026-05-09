/**
 * User stats API client wrapper — Stage 3.9.B polish
 *
 * Wraps GET /api/user-stats which returns aggregated counters
 * across ALL of a user's wisdoms — used by the Assets tab progress
 * bars and the keyword Collection grid. Avoids paginating /api/wisdoms
 * (which is capped at 100 rows per page) just to count things.
 */
import { apiClient } from './api';
import { storage } from './storage';

export type UserStats = {
  success: boolean;
  totalWords: number;
  totalWisdoms: number;
  uniqueKeywords: number;
  keywordCounts: Record<string, number>;
};

export async function fetchUserStats(userId: string): Promise<UserStats> {
  const qs = new URLSearchParams({ userId });
  return apiClient.get<UserStats>(`/api/user-stats?${qs.toString()}`);
}

// ============================================================
// SWR Cache Layer — Stage 6
// MMKV key: novame_user_stats
// Used by: assets.tsx (Collection sub-tab + Assets progress bars)
// ============================================================

const USER_STATS_STORAGE_KEY = 'novame_user_stats';

export type CachedUserStats = UserStats & { lastFetchedAtMs: number };

export function getCachedUserStats(): UserStats | null {
  const raw = storage.getString(USER_STATS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedUserStats;
    const { lastFetchedAtMs: _ts, ...stats } = parsed;
    return stats;
  } catch {
    return null;
  }
}

function setCachedUserStats(stats: UserStats): void {
  const payload: CachedUserStats = { ...stats, lastFetchedAtMs: Date.now() };
  storage.set(USER_STATS_STORAGE_KEY, JSON.stringify(payload));
}

export function invalidateUserStats(): void {
  storage.remove(USER_STATS_STORAGE_KEY);
}

export async function fetchUserStatsWithCache(userId: string): Promise<UserStats> {
  const res = await fetchUserStats(userId);
  setCachedUserStats(res);
  return res;
}
