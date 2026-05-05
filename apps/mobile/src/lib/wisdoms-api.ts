/**
 * wisdoms API client wrapper — Stage 3.9.A.2.4
 *
 * Wraps GET /api/wisdoms which returns the user's own published
 * wisdoms with the generated wisdom_card joined in. Used by Growth
 * tab's My Logs sub-tab.
 */
import { apiClient } from './api';

export type WisdomCardEmbed = {
  id: string;
  keyword_id: string | null;
  quote_short: string | null;
  insight_full: string | null;
  wisdom_score: number | null;
  wisdom_emotion: string | null;
};

export type WisdomLog = {
  id: string;
  created_at: string;
  text: string | null;
  description: string | null;
  categories: string[] | null;
  card: WisdomCardEmbed | null;
};

export type FetchWisdomsResponse = {
  success: boolean;
  wisdoms: WisdomLog[];
  total: number;
};

export async function fetchWisdoms(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<FetchWisdomsResponse> {
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;
  const qs = new URLSearchParams({
    userId,
    limit: String(limit),
    offset: String(offset),
  });
  return apiClient.get<FetchWisdomsResponse>(`/api/wisdoms?${qs.toString()}`);
}
