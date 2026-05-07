/**
 * User stats API client wrapper — Stage 3.9.B polish
 *
 * Wraps GET /api/user-stats which returns aggregated counters
 * across ALL of a user's wisdoms — used by the Assets tab progress
 * bars and the keyword Collection grid. Avoids paginating /api/wisdoms
 * (which is capped at 100 rows per page) just to count things.
 */
import { apiClient } from './api';

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
