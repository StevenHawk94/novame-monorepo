import { storage } from './storage';
import { apiClient } from './api';
import type { PricingTierKey } from '@novame/core';

/**
 * Me-page stats state management for mobile (stage 3.10.1).
 *
 * Mirrors the character-state.ts / subscription.ts pattern: cache-first
 * read, server fetch from a parallel parent loader, MMKV persistence.
 *
 * Architecture (per Stage 3.10 design):
 *   - Home tab fetches me-stats in the background ~1.5s after mount
 *     (after character-state + subscription are settled). This warms
 *     the cache before the user can possibly tap the hamburger.
 *   - Me modal renders from cache only -- never triggers its own fetch.
 *     Cache miss is rare (network failure during home warm-up); UI
 *     shows "--" placeholders in that case.
 *   - record.tsx PhasePublishing fires invalidateMeStats() + a silent
 *     refetch after each new wisdom. So when the user finishes
 *     publishing -> returns home -> opens me, totalWords / totalCards /
 *     usedThisMonth all reflect the new wisdom.
 *
 * Why a single endpoint and not 5 parallel calls (like old web MeView):
 *   - mobile wisdoms route caps at limit=100; client-side word-count
 *     accumulation is unsound for power users
 *   - 1 round-trip vs 5 = noticeably faster on cellular networks
 *
 * MMKV key: novame_me_stats
 */

const STORAGE_KEY = 'novame_me_stats';

// ---- types ----

type MeStatsResponse = {
  success: boolean;
  stats: {
    totalWords: number;
    totalCards: number;
    peopleImpacted: number;
    totalExp: number;
    betterSelfScore: number;
    usedThisMonth: number;
    monthlyAnalyses: number;
    planTier: PricingTierKey;
    planName: string;
  };
  profile: {
    displayName: string;
    avatarUrl: string;
  };
};

export type CachedMeStats = {
  totalWords: number;
  totalCards: number;
  peopleImpacted: number;
  totalExp: number;
  betterSelfScore: number;
  usedThisMonth: number;
  monthlyAnalyses: number;
  planTier: PricingTierKey;
  planName: string;
  displayName: string;
  avatarUrl: string;
  lastFetchedAtMs: number;
};

// ---- mmkv read / write ----

export function getCachedMeStats(): CachedMeStats | null {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedMeStats;
  } catch {
    return null;
  }
}

export function setCachedMeStats(state: CachedMeStats): void {
  storage.set(STORAGE_KEY, JSON.stringify(state));
}

export function clearCachedMeStats(): void {
  storage.remove(STORAGE_KEY);
}

/**
 * Same as clearCachedMeStats today, but exists as a distinct named
 * export so consumers (record publish success, future avatar upload
 * success) communicate intent: "the stats I have are now stale; please
 * re-fetch when convenient." The actual re-fetch is the caller's job --
 * typically by also calling fetchMeStats() in fire-and-forget.
 */
export function invalidateMeStats(): void {
  storage.remove(STORAGE_KEY);
}

// ---- server fetch ----

export async function fetchMeStats(userId: string): Promise<CachedMeStats> {
  const data = await apiClient.get<MeStatsResponse>(
    `/api/me-stats?userId=${encodeURIComponent(userId)}`,
  );
  if (!data.success) {
    throw new Error('me-stats GET returned non-success');
  }
  const next: CachedMeStats = {
    totalWords: data.stats.totalWords,
    totalCards: data.stats.totalCards,
    peopleImpacted: data.stats.peopleImpacted,
    totalExp: data.stats.totalExp,
    betterSelfScore: data.stats.betterSelfScore,
    usedThisMonth: data.stats.usedThisMonth,
    monthlyAnalyses: data.stats.monthlyAnalyses,
    planTier: data.stats.planTier,
    planName: data.stats.planName,
    displayName: data.profile.displayName,
    avatarUrl: data.profile.avatarUrl,
    lastFetchedAtMs: Date.now(),
  };
  setCachedMeStats(next);
  return next;
}
