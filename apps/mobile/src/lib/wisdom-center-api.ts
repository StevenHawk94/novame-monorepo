import { apiClient } from './api';
import { storage } from './storage';

/**
 * Wisdom Center API wrapper -- Stage 3.10.3 A.
 *
 * One GET endpoint feeds two distinct overlays:
 *   - Growth Center (Stage 3.10.3 A)        : portrait, aspire scores,
 *                                             better-self gauge, community
 *                                             resonance.
 *   - Weekly Evolution Report (Stage 3.10.3 B): latestReport (4 sections
 *                                             generated server-side via
 *                                             Gemini) + same metadata.
 *
 * Server: /api/wisdom-center returns the full payload regardless of
 * which overlay opened it; we just read the fields we need.
 *
 * No caching for now -- this is low-frequency (Growth Center is opened
 * from Me page Better Self Match Details, Weekly Report from Home tab
 * trophy/middle button, neither is on a hot path).
 */

export type DefaultAvatar = {
  url: string;
  name: string;
};

/** Server-side report_data shape for the weekly evolution report. */
export type WeeklyReportData = {
  section1_pulse?: {
    activeDays?: number;
    betterSelfStart?: number;
    betterSelfEnd?: number;
    traitChanges?: Array<{ trait: string; score?: number; change?: number }>;
  };
  section2_narrative?: {
    journey?: string;
    corelesson?: string;
  };
  section3_echo?: {
    totalResonance?: number;
    message?: string;
  };
  section4_path?: {
    focusTrait?: string;
    focusReason?: string;
    motto?: string;
  };
};

export type WisdomCenterData = {
  portrait: string;
  aspireWords: string[];
  aspireScores: Record<string, number>;
  betterSelfScore: number;
  communityResonance: number;
  reportAvailable: boolean;
  reportDate: string | null;
  latestReport: WeeklyReportData | null;
  shareCount: number;
  defaultAvatars: DefaultAvatar[];
};

export type WisdomCenterResult =
  | { kind: 'success'; data: WisdomCenterData }
  | { kind: 'error'; message: string };

export async function fetchWisdomCenter(
  userId: string,
): Promise<WisdomCenterResult> {
  type WireResponse = {
    success: boolean;
    error?: string;
  } & Partial<WisdomCenterData>;

  try {
    const data = await apiClient.get<WireResponse>(
      `/api/wisdom-center?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success) {
      return { kind: 'error', message: data.error || 'Failed to load' };
    }
    return {
      kind: 'success',
      data: {
        portrait: data.portrait ?? '',
        aspireWords: data.aspireWords ?? [],
        aspireScores: data.aspireScores ?? {},
        betterSelfScore: data.betterSelfScore ?? 70,
        communityResonance: data.communityResonance ?? 0,
        reportAvailable: data.reportAvailable ?? false,
        reportDate: data.reportDate ?? null,
        latestReport: data.latestReport ?? null,
        shareCount: data.shareCount ?? 0,
        defaultAvatars: data.defaultAvatars ?? [],
      },
    };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}

/**
 * POST /api/wisdom-center -- generate a fresh weekly report. Used by
 * Stage 3.10.3 B (Weekly Report overlay). Server checks the user has
 * shared >=2 wisdoms this week before generating; if not, returns
 * { notEnough: true } and we surface a friendly message.
 */
export type GenerateReportResult =
  | { kind: 'success'; report: WeeklyReportData }
  | { kind: 'notEnough' }
  | { kind: 'error'; message: string };

export async function generateWeeklyReport(
  userId: string,
): Promise<GenerateReportResult> {
  type WireResponse = {
    success?: boolean;
    report?: WeeklyReportData;
    cached?: boolean;
    notEnough?: boolean;
    error?: string;
  };

  try {
    const data = await apiClient.post<WireResponse>('/api/wisdom-center', {
      userId,
    });
    if (data.notEnough) return { kind: 'notEnough' };
    if (data.success && data.report) {
      return { kind: 'success', report: data.report };
    }
    return { kind: 'error', message: data.error || 'Failed to generate report' };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}

// ============================================================
// updateAspireWords -- Stage 6 editable aspire-words
// ============================================================

/**
 * POST /api/update-profile { userId, aspireWords } -- updates the
 * profile's aspire_words array and recomputes better_self_score
 * server-side using strategy B (preserve historical aspire_scores).
 *
 * Server logic (apps/api/src/app/api/update-profile/route.js):
 *   - aspire_scores dict left untouched (removed words keep their score,
 *     re-added words restore from history).
 *   - better_self_score = round(avg(currentWords.map(w =>
 *     existingScores[w] ?? 70))). Newly added words contribute 70 to
 *     the average without being persisted to scores (their persisted
 *     score is born on the next publish-wisdom that includes them in
 *     aspire_impacts).
 */
export type UpdateAspireWordsResult =
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export async function updateAspireWords(
  userId: string,
  aspireWords: string[],
): Promise<UpdateAspireWordsResult> {
  type WireResponse =
    | { success: true; profile?: unknown }
    | { success?: false; error: string };

  try {
    const data = await apiClient.post<WireResponse>('/api/update-profile', {
      userId,
      aspireWords,
    });
    if (data.success === true) {
      return { kind: 'success' };
    }
    return {
      kind: 'error',
      message: (data as { error: string }).error || 'Update failed',
    };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}


// ============================================================
// SWR Cache Layer — Stage 6 Bug 3 polish (Wisdom Insight 3-bug
// real-test fix Layer 2)
//
// Prior state: this module had no cache at all. Every visit to
// Growth Center / Weekly Report / edit-aspire-words / wisdom-insight
// triggered a full /api/wisdom-center round-trip, with no benefit
// from prior fetches. The Stage 6 publish-side prefetch strategy
// requires a cache target so post-publish refreshes have somewhere
// to land — this layer provides it, matching the SWR pattern of
// user-stats-api / wisdoms-api / etc.
//
// MMKV key: novame_wisdom_center
//
// Used by (after commit 18 cache-first wiring lands):
//   - Growth Center modal (instant render from cache, background refresh)
//   - wisdom-insight modal (read aspireScores for Block 4b without
//     blocking on network — closes the "aspire bar missing in
//     My Logs" issue from the real-test feedback round)
//   - edit-aspire-words modal (same pattern)
//
// Cross-user safety: clearCachedWisdomCenter is called from
// _layout.tsx SIGNED_IN and SIGNED_OUT handlers (matches the existing
// pattern for the other 4 user-scoped caches — subscription / me-stats
// / character-state / config). See DEVELOPMENT.md §4.5 "Why sign-out
// clearing matters (Bug #5 from 5.IAP.5)" for the original rationale.
// ============================================================

const WISDOM_CENTER_STORAGE_KEY = 'novame_wisdom_center';

export type CachedWisdomCenter = WisdomCenterData & { lastFetchedAtMs: number };

export function getCachedWisdomCenter(): WisdomCenterData | null {
  const raw = storage.getString(WISDOM_CENTER_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedWisdomCenter;
    const { lastFetchedAtMs: _ts, ...data } = parsed;
    return data;
  } catch {
    return null;
  }
}

export function setCachedWisdomCenter(data: WisdomCenterData): void {
  const payload: CachedWisdomCenter = { ...data, lastFetchedAtMs: Date.now() };
  storage.set(WISDOM_CENTER_STORAGE_KEY, JSON.stringify(payload));
}

export function clearCachedWisdomCenter(): void {
  storage.remove(WISDOM_CENTER_STORAGE_KEY);
}

/**
 * Synonym for clearCachedWisdomCenter — same semantics, different
 * intent for the reader (matches invalidateMeStats / invalidateWisdoms
 * naming convention used by SWR caches written-through after a mutation).
 */
export function invalidateWisdomCenter(): void {
  storage.remove(WISDOM_CENTER_STORAGE_KEY);
}

/**
 * Cache-aware fetch. Preserves the existing fetchWisdomCenter
 * discriminated-union return contract (caller still pattern-matches
 * res.kind === 'success'); on success, writes through to MMKV.
 *
 * On error, leaves the cache untouched — stale-while-revalidate
 * semantics. Callers should fall back to getCachedWisdomCenter() for
 * a last-known-good render in that case.
 */
export async function fetchWisdomCenterWithCache(
  userId: string,
): Promise<WisdomCenterResult> {
  const res = await fetchWisdomCenter(userId);
  if (res.kind === 'success') {
    setCachedWisdomCenter(res.data);
  }
  return res;
}

/**
 * Stage 6 publish-side prefetch (Wisdom Insight 3-bug series Layer 1).
 *
 * Clears the MMKV cache and immediately fetches the latest payload.
 * Used by record.tsx publish success path so the post-publish
 * aspire_scores / better_self_score / shareCount are populated in
 * cache by the time the user closes the Insight modal and visits
 * Growth Center or My Logs.
 *
 * fire-and-forget safe: never throws.
 */
export async function refreshWisdomCenter(userId: string): Promise<void> {
  storage.remove(WISDOM_CENTER_STORAGE_KEY);
  try {
    await fetchWisdomCenterWithCache(userId);
  } catch (e) {
    console.warn('[refreshWisdomCenter]', e);
  }
}
