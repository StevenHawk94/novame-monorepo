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
const ME_STATS_TTL_MS = 30 * 60 * 1000;
const fetchesInFlight = new Map<string, Promise<CachedMeStats>>();

// ---- defaults ----

/**
 * Default me-stats for a newly-signed-up user, used as an instant
 * placeholder by signing-in.tsx so the Me page can render meaningful
 * values from frame 1 instead of "Wisdom Seeker" / default avatar /
 * "--" placeholders.
 *
 * Verified against the server contract for a fresh account:
 *   - totalWords     = 0      (no wisdoms yet)
 *   - totalCards     = 1      (the onboarding starter card)
 *   - peopleImpacted = 0      (profile.people_impacted_display default)
 *   - totalExp       = 0      (character_data default)
 *   - betterSelfScore= 70     (profile default)
 *   - usedThisMonth  = 0      (starter card has wisdom_id IS NULL so
 *                              it is excluded by the me-stats route's
 *                              .not('wisdom_id','is',null) filter)
 *   - monthlyAnalyses= 1      (free tier from PRICING_TIERS)
 *   - planTier       = 'free' (subscription_tier default)
 *   - planName       = 'Free'
 *
 * `displayName` is intentionally empty -- signing-in.tsx fills it
 * from MMKV onboarding state (user named themselves at step 10).
 *
 * `avatarUrl` is intentionally empty -- new profiles carry no
 * avatar_url (the legacy server-side default_avatars system was
 * dropped in migration 037); the client renders the bundled default
 * portrait picked from the userId.
 *
 * Stage 5.WR.2 (new-user instant-home pattern).
 */
export const DEFAULT_NEW_USER_ME_STATS: CachedMeStats = {
  totalWords: 0,
  totalCards: 1,
  peopleImpacted: 0,
  totalExp: 0,
  betterSelfScore: 70,
  usedThisMonth: 0,
  monthlyAnalyses: 1,
  planTier: 'free',
  planName: 'Free',
  displayName: '',
  avatarUrl: '',
  isDefaultAvatar: true,
  lastFetchedAtMs: 0,
};

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
    isDefaultAvatar?: boolean;
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
  /** false only when the user uploaded a real avatar (profiles.is_default_avatar). */
  isDefaultAvatar: boolean;
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
  const cached = getCachedMeStats();
  if (cached) setCachedMeStats({ ...cached, lastFetchedAtMs: 0 });
}

// ---- server fetch ----

export async function fetchMeStats(
  userId: string,
  options?: { force?: boolean },
): Promise<CachedMeStats> {
  const cached = getCachedMeStats();
  if (
    !options?.force
    && cached
    && Date.now() - cached.lastFetchedAtMs < ME_STATS_TTL_MS
  ) {
    return cached;
  }
  const existing = fetchesInFlight.get(userId);
  if (existing) return existing;

  const request = (async () => {
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
      isDefaultAvatar: data.profile.isDefaultAvatar !== false,
      lastFetchedAtMs: Date.now(),
    };
    setCachedMeStats(next);
    return next;
  })().finally(() => {
    fetchesInFlight.delete(userId);
  });
  fetchesInFlight.set(userId, request);
  return request;
}

/**
 * Stage 6 publish-side prefetch (Wisdom Insight 3-bug series Layer 1).
 *
 * Replaces the ad-hoc pattern in record.tsx of "invalidateMeStats() +
 * fire-and-forget fetchMeStats" with a single named helper. Behaviour
 * is identical (clear + immediate fetch), naming aligns with all other
 * publish-side prefetch helpers (refreshWisdoms / refreshUserStats /
 * refreshDailyTasks / refreshLeaderboard / refreshCharacterState).
 *
 * fire-and-forget safe: never throws.
 */
export async function refreshMeStats(userId: string): Promise<void> {
  try {
    await fetchMeStats(userId, { force: true });
  } catch (e) {
    console.warn('[refreshMeStats]', e);
  }
}
