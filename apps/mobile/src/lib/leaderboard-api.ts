import { apiClient } from './api';
import { storage } from './storage';

/**
 * Leaderboard API wrapper -- Stage 3.10.3 C (Stage 6.LeaderboardExpUnify).
 *
 * Single GET to /api/leaderboard?period=all&limit=50. The server
 * merges leaderboard_seeds (curated default users) with real users
 * pulled from character_data.total_exp, sorts by totalExp desc, and
 * returns the top N as a single pre-ranked list.
 *
 * totalExp is the SAME number shown on the me page's exp pill, so a
 * user's leaderboard rank matches the exp they see in their profile.
 * Seed users' total_mins legacy values are aliased to totalExp at
 * the API layer (same magnitude as real users' exp, see route comment).
 */

export type LeaderboardEntry = {
  /** Stable id (real user UUID for real users, "seed-{name}" for seeds). */
  userId: string;
  /** Display name. */
  name: string;
  /** Public avatar URL (supabase storage), nullable -- caller falls back to icon. */
  avatar: string | null;
  /** Score: character_data.total_exp for real users, leaderboard_seeds.total_mins (aliased) for seeds. */
  totalExp: number;
  /** True for curated leaderboard_seeds rows. */
  isDefault: boolean;
  /** 1-based rank within this fetch. */
  rank: number;
};

export type LeaderboardResult =
  | { kind: 'success'; entries: LeaderboardEntry[] }
  | { kind: 'error'; message: string };

export async function fetchLeaderboard(
  limit: number = 50,
): Promise<LeaderboardResult> {
  type WireResponse = {
    success: boolean;
    period?: string;
    leaderboard?: LeaderboardEntry[];
    totalUsers?: number;
    error?: string;
  };

  try {
    const data = await apiClient.get<WireResponse>(
      `/api/leaderboard?period=all&limit=${limit}`,
    );
    if (!data.success) {
      return { kind: 'error', message: data.error || 'Failed to load leaderboard' };
    }
    return { kind: 'success', entries: data.leaderboard ?? [] };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}

// ============================================================
// SWR Cache Layer — Stage 6
// MMKV key: novame_leaderboard
// Used by: ranking.tsx
// ============================================================

// Stage 6.LeaderboardExpUnify bumped this key from
// 'novame_leaderboard' to 'novame_leaderboard_v2' so old cached
// entries (with the legacy `totalMinutes` field) are invalidated
// rather than corrupting the UI which now reads `totalExp`.
const LEADERBOARD_STORAGE_KEY = 'novame_leaderboard_v2';

export type CachedLeaderboard = {
  entries: LeaderboardEntry[];
  lastFetchedAtMs: number;
};

export function getCachedLeaderboard(): LeaderboardEntry[] | null {
  const raw = storage.getString(LEADERBOARD_STORAGE_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as CachedLeaderboard).entries ?? null;
  } catch {
    return null;
  }
}

function setCachedLeaderboard(entries: LeaderboardEntry[]): void {
  const payload: CachedLeaderboard = { entries, lastFetchedAtMs: Date.now() };
  storage.set(LEADERBOARD_STORAGE_KEY, JSON.stringify(payload));
}

export function invalidateLeaderboard(): void {
  storage.remove(LEADERBOARD_STORAGE_KEY);
}

export async function fetchLeaderboardWithCache(
  limit: number = 50,
): Promise<LeaderboardResult> {
  const res = await fetchLeaderboard(limit);
  if (res.kind === 'success') {
    setCachedLeaderboard(res.entries);
  }
  return res;
}

/**
 * Stage 6 publish-side prefetch (Wisdom Insight 3-bug series Layer 1).
 *
 * No userId param — the leaderboard is global (server merges all real
 * users with curated seeds). Publish bumps the user's total_exp, which
 * changes their rank, so the cache becomes stale and must be refreshed.
 *
 * fire-and-forget safe: never throws.
 */
export async function refreshLeaderboard(): Promise<void> {
  storage.remove(LEADERBOARD_STORAGE_KEY);
  try {
    await fetchLeaderboardWithCache();
  } catch (e) {
    console.warn('[refreshLeaderboard]', e);
  }
}
