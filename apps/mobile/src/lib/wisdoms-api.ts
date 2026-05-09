/**
 * wisdoms API client wrapper — Stage 3.9.A.2.4
 *
 * Wraps GET /api/wisdoms which returns the user's own published
 * wisdoms with the generated wisdom_card joined in. Used by Growth
 * tab's My Logs sub-tab.
 */
import { apiClient } from './api';
import { storage } from './storage';

export type WisdomCardEmbed = {
  id: string;
  keyword_id: string | null;
  quote_short: string | null;
  insight_full: string | null;
  wisdom_score: number | null;
  wisdom_emotion: string | null;
  card_b: string | null;
  card_c: string | null;
  task_1: string | null;
  task_2: string | null;
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

// ============================================================
// SWR Cache Layer — Stage 6 (cache-first reads, publish invalidation)
// MMKV key: novame_wisdom_logs
// Used by: growth.tsx (My Logs sub-tab)
// ============================================================

const WISDOMS_STORAGE_KEY = 'novame_wisdom_logs';

export type CachedWisdoms = {
  wisdoms: WisdomLog[];
  total: number;
  lastFetchedAtMs: number;
};

export function getCachedWisdoms(): { wisdoms: WisdomLog[]; total: number } | null {
  const raw = storage.getString(WISDOMS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedWisdoms;
    return { wisdoms: parsed.wisdoms, total: parsed.total };
  } catch {
    return null;
  }
}

function setCachedWisdoms(wisdoms: WisdomLog[], total: number): void {
  const payload: CachedWisdoms = { wisdoms, total, lastFetchedAtMs: Date.now() };
  storage.set(WISDOMS_STORAGE_KEY, JSON.stringify(payload));
}

export function invalidateWisdoms(): void {
  storage.remove(WISDOMS_STORAGE_KEY);
}

export async function fetchWisdomsWithCache(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<FetchWisdomsResponse> {
  const res = await fetchWisdoms(userId, opts);
  // Only cache the "default first page" view (offset 0). Pagination
  // queries are not cached because they're rare and complex to merge.
  if ((opts.offset ?? 0) === 0) {
    setCachedWisdoms(res.wisdoms ?? [], res.total ?? 0);
  }
  return res;
}
