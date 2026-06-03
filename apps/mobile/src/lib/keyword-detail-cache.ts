/**
 * Per-keyword cache for the Collection keyword-detail modal.
 *
 * keyword-detail merges two queries (fetchWisdoms limit=200 + the
 * generate-abc-cards orphan/starter cards) and filters by keyword,
 * so neither the shared getCachedWisdoms (limit=30) nor any existing
 * cache fits. This stores the merged WisdomLog[] per keyword slug so
 * the modal renders instantly from cache instead of a full-screen
 * spinner on every open.
 *
 * Cache-first only: the modal still re-fetches in the background on
 * every open (refresh logic unchanged) and writes the fresh merged
 * list back here. No time threshold, no publish invalidation — the
 * background refresh keeps it current (cross-device / social fields
 * included); the cache exists solely to remove the open-time spinner.
 *
 * Keyed by slug (= keyword_id, e.g. 'mind-clarity'). MMKV key:
 * novame_kwdetail:{slug}.
 */
import { storage } from './storage';
import type { WisdomLog } from './wisdoms-api';

const PREFIX = 'novame_kwdetail:';

type CachedKeywordDetail = {
  wisdoms: WisdomLog[];
  lastFetchedAtMs: number;
};

export function getCachedKeywordDetail(slug: string): WisdomLog[] | null {
  if (!slug) return null;
  const raw = storage.getString(PREFIX + slug);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedKeywordDetail;
    return parsed.wisdoms ?? null;
  } catch {
    return null;
  }
}

export function setCachedKeywordDetail(slug: string, wisdoms: WisdomLog[]): void {
  if (!slug) return;
  const payload: CachedKeywordDetail = { wisdoms, lastFetchedAtMs: Date.now() };
  storage.set(PREFIX + slug, JSON.stringify(payload));
}
