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

export async function fetchSeekQuestionsWithCache(
  filterKey: string,
  selectedKeywords: string[],
): Promise<SeekQuestion[]> {
  const qs = selectedKeywords.length > 0
    ? `?keywords=${encodeURIComponent(selectedKeywords.join(','))}`
    : '';
  const data = await apiClient.get<FetchResp>(`/api/seek-questions${qs}`);
  const questions = data.questions ?? [];
  setCachedSeekQuestions(filterKey, questions);
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
