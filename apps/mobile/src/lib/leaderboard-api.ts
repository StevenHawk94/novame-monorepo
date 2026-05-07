import { apiClient } from './api';

/**
 * Leaderboard API wrapper -- Stage 3.10.3 C.
 *
 * Single GET to /api/leaderboard?period=all&limit=50. The server
 * merges leaderboard_seeds (curated default users) with real users
 * aggregated from the wisdoms table (totalMinutes per user_id),
 * sorts by totalMinutes desc, and returns the top N as a single
 * pre-ranked list.
 *
 * The mobile UI relabels totalMinutes as "exp" (carryover from old
 * web -- the score really is wisdom-creation minutes, but "exp" is
 * the user-facing term across both web and mobile).
 */

export type LeaderboardEntry = {
  /** Stable id (real user UUID for real users, "seed-{name}" for seeds). */
  userId: string;
  /** Display name. */
  name: string;
  /** Public avatar URL (supabase storage), nullable -- caller falls back to icon. */
  avatar: string | null;
  /** Score the UI shows as "exp" -- really wisdom-creation minutes. */
  totalMinutes: number;
  /** How many wisdoms this user has shared. */
  wisdomCount: number;
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
