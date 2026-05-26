/**
 * SWR Cache Layer for /api/seek-questions — Stage 6
 *
 * Used by: discover.tsx (question feed)
 *
 * MMKV key: novame_seek_questions:{filter}
 * (per-filter caching so switching keyword filters doesn't blow away
 *  the unfiltered cache; each unique filter combo gets its own slot)
 *
 * Note: fetcher always hits server. The cache is for INSTANT first-paint
 * on tab switch, not for offline mode.
 */
import { apiClient } from './api';
import { storage } from './storage';
import type { SeekQuestion } from './seek-types';

type FetchResp = { questions?: SeekQuestion[] };

const STORAGE_KEY_PREFIX = 'novame_seek_questions:';

type CachedSeekQuestions = {
  questions: SeekQuestion[];
  lastFetchedAtMs: number;
};

function keyForFilter(filterKey: string): string {
  return `${STORAGE_KEY_PREFIX}${filterKey || 'all'}`;
}

export function getCachedSeekQuestions(filterKey: string): SeekQuestion[] | null {
  const raw = storage.getString(keyForFilter(filterKey));
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as CachedSeekQuestions).questions ?? null;
  } catch {
    return null;
  }
}

function setCachedSeekQuestions(filterKey: string, questions: SeekQuestion[]): void {
  const payload: CachedSeekQuestions = {
    questions,
    lastFetchedAtMs: Date.now(),
  };
  storage.set(keyForFilter(filterKey), JSON.stringify(payload));
}

/**
 * Invalidate ALL cached question feeds (every filter combo). Called by
 * record.tsx PhasePublishing when a new wisdom is published — the
 * card count badge on every question may have changed.
 */
export function invalidateSeekQuestions(): void {
  // MMKV doesn't support prefix scan, so iterate via getAllKeys.
  const allKeys = storage.getAllKeys();
  for (const k of allKeys) {
    if (k.startsWith(STORAGE_KEY_PREFIX)) {
      storage.remove(k);
    }
  }
}

/**
 * Stage 6 follow-up (Discover infinite-scroll): fetch a page of
 * seek-questions with optional cache write-through.
 *
 * Pagination semantics (mirrors apps/mobile/src/lib/wisdoms-api.ts):
 *   - opts.limit  defaults to 20 (matches server-side default in
 *                 /api/seek-questions route.js).
 *   - opts.offset defaults to 0.
 *   - The cache is ONLY written when offset === 0 — pagination
 *     pages 2..N are returned to the caller but not persisted.
 *     Rationale: caching a single first-page view is what gives
 *     instant cold-start render; caching every page combo would
 *     bloat MMKV with little benefit (a returning user always
 *     starts at page 0 anyway).
 *
 * Client computes hasMore from `returned.length === limit` per the
 * Q-18.2 = B decision (no separate total-count round-trip).
 *
 * Backwards compatible: existing call sites that pass no opts get
 * { limit: 20, offset: 0 } automatically. refreshSeekQuestions()
 * still works unchanged — it always fetches page 0 by passing no
 * opts.
 */
export async function fetchSeekQuestionsWithCache(
  filterKey: string,
  selectedKeywords: string[],
  opts: { limit?: number; offset?: number } = {},
): Promise<SeekQuestion[]> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const params = new URLSearchParams();
  if (selectedKeywords.length > 0) {
    params.set('keywords', selectedKeywords.join(','));
  }
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const qs = `?${params.toString()}`;

  const data = await apiClient.get<FetchResp>(`/api/seek-questions${qs}`);
  const questions = data.questions ?? [];

  // Cache only the first-page view (offset 0) per the wisdoms-api
  // pattern. Pagination pages 2..N are still returned for caller
  // append, just not persisted.
  if (offset === 0) {
    setCachedSeekQuestions(filterKey, questions);
  }
  return questions;
}

/**
 * Stage 6 publish-side prefetch + AppState foreground refresh helper.
 *
 * Combines invalidate (all filter slots) + immediate fetch of the
 * default unfiltered feed. Per Q-G1 decision (γ): the default
 * unfiltered feed covers ~80% of user sessions; users who applied
 * a filter will see fresh data the next time they navigate back to
 * Discover (the tab's useFocusEffect refetches the active filter).
 *
 * Used by:
 *   - record.tsx publish success batch (commit 15): publish creates
 *     new cards across multiple keywords, every question's
 *     wisdomCount badge is potentially stale.
 *   - _layout.tsx AppState foreground refresh (commit 16): 30+
 *     minute background return triggers a global cache refresh;
 *     this helper is one of the batch entries.
 *
 * fire-and-forget safe: never throws.
 */
export async function refreshSeekQuestions(): Promise<void> {
  // invalidateSeekQuestions clears every filter-scoped cache slot;
  // we then re-fetch only the default unfiltered view.
  invalidateSeekQuestions();
  try {
    await fetchSeekQuestionsWithCache('', []);
  } catch (e) {
    console.warn('[refreshSeekQuestions]', e);
  }
}
