import { storage } from './storage';
import { apiClient } from './api';
import { supabase } from './supabase';
import type { PricingTierKey } from '@novame/core';

/**
 * Subscription state management for mobile (stage 3.7.4).
 *
 * Mirrors the character-state.ts pattern (cache-first read, background
 * server refresh). Exists as a separate module because subscription is
 * a different domain from character growth — they happen to be loaded
 * at the same time, but evolve independently (subscription only changes
 * when the user buys/cancels via IAP; character changes constantly).
 *
 * Data source — old capacitor pattern:
 *   - GET /api/user-sync?userId=X already returns `data.subscriptionTier`
 *     ('free' | 'basic' | 'pro' | 'ultra'), authoritative from the
 *     profiles.subscription_tier column written by /api/apple-iap and
 *     /api/google-iap (StoreKit 2 / Play Billing v7).
 *   - We only cache the tier string. Detailed billing info (cycle,
 *     period_end, status) lives behind GET /api/subscriptions and is
 *     consumed by the Plan & Billing modal in stage 3.10.
 *
 * MMKV key: novame_subscription
 *
 * Stage 5 (IAP integration) will:
 *   - extend this cache with billing_cycle / period_end if needed
 *   - trigger fetchSubscriptionTier() after a successful purchase
 *
 * Until IAP ships, fetchSubscriptionTier() always returns 'free' for
 * real users — but the data path is fully wired so the day IAP turns
 * on, no consumer needs to change.
 */

const STORAGE_KEY = 'novame_subscription';
const SUBSCRIPTION_TTL_MS = 5 * 60 * 1000;
const fetchesInFlight = new Map<string, Promise<CachedSubscription>>();
const tierListeners = new Set<() => void>();

// ---- types ----

/**
 * Subset of /api/user-sync GET response that we care about for
 * subscription. Other fields (profile, wisdoms, etc.) are read by
 * the screens that need them — we only consume subscriptionTier here.
 */
type UserSyncSubscriptionShape = {
  success: boolean;
  data: {
    subscriptionTier?: PricingTierKey;
  };
};

export type CachedSubscription = {
  /** Active tier. Defaults to 'free' for users who have never purchased. */
  tier: PricingTierKey;
  /** Wall-clock timestamp of the last successful server fetch. */
  lastFetchedAtMs: number;
  /** Added after the old sign-in bootstrap stopped writing a temporary Free
   * tier. Missing means the record may be that legacy placeholder. */
  serverConfirmed?: boolean;
};

// ---- mmkv read / write ----

/**
 * Reads cached subscription from MMKV. Returns null if no cache exists
 * (first launch after sign-in) or if the cached value is corrupt JSON.
 */
export function getCachedSubscription(): CachedSubscription | null {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSubscription;
  } catch {
    return null;
  }
}

/**
 * Convenience: returns the active tier, defaulting to 'free' if no
 * cache exists yet. UI render paths that just need a tier string
 * (e.g. PRICING_TIERS lookup) should use this instead of the full
 * getCachedSubscription helper.
 */
export function getCachedSubscriptionTier(): PricingTierKey {
  return getCachedSubscription()?.tier ?? 'free';
}

/** Distinguishes an authoritative/cached Free tier from a cache that has not
 * been hydrated yet. Most gates should keep using getCachedSubscriptionTier;
 * launch UI that must avoid a false Free first frame can use this snapshot. */
export function getCachedSubscriptionTierState(): PricingTierKey | null {
  const cached = getCachedSubscription();
  if (!cached) return null;
  // Paid was never used as a bootstrap placeholder. A legacy Free entry,
  // however, may have been written before the server replied and must remain
  // "hydrating" until it is reconciled once.
  if (cached.tier === 'free' && !cached.serverConfirmed) return null;
  return cached.tier;
}

/**
 * Persists subscription state to MMKV cache.
 */
export function setCachedSubscription(state: CachedSubscription): void {
  const previousTierState = getCachedSubscriptionTierState();
  storage.set(STORAGE_KEY, JSON.stringify(state));
  if (previousTierState !== getCachedSubscriptionTierState()) {
    for (const listener of tierListeners) listener();
  }
}

/** Subscribe only to effective entitlement changes. This does not alter the
 * existing cache TTL, fetch policy, storage key, or page-data caches. */
export function subscribeToSubscriptionTier(listener: () => void): () => void {
  tierListeners.add(listener);
  return () => tierListeners.delete(listener);
}

/**
 * Clears cached subscription (sign-out, account switch, etc.).
 */
export function clearCachedSubscription(): void {
  const hadCachedSubscription = getCachedSubscription() !== null;
  storage.remove(STORAGE_KEY);
  if (hadCachedSubscription) {
    for (const listener of tierListeners) listener();
  }
}

// ---- server fetch ----

/**
 * Fetches the user's tier from /api/user-sync, persists to MMKV cache,
 * and returns the resulting CachedSubscription.
 *
 * Throws on network or HTTP errors. Caller should treat failure as
 * non-fatal — stale cache (or 'free' default) keeps the UI working.
 *
 * Why user-sync and not /api/subscriptions:
 *   - user-sync already returns subscriptionTier alongside profile +
 *     onboarding flags, so calling it gives us tier "for free" if any
 *     other consumer also wants user-sync data later.
 *   - /api/subscriptions returns the verbose subscription row (billing
 *     history, period_start/end) — Plan & Billing modal only.
 */
export async function fetchSubscriptionTier(
  userId: string,
  options?: { force?: boolean },
): Promise<CachedSubscription> {
  const cached = getCachedSubscription();
  if (
    !options?.force
    && cached
    && cached.serverConfirmed
    && Date.now() - cached.lastFetchedAtMs < SUBSCRIPTION_TTL_MS
  ) {
    return cached;
  }
  const existing = fetchesInFlight.get(userId);
  if (existing) return existing;

  const request = (async () => {
    const data = await apiClient.get<UserSyncSubscriptionShape>(
      `/api/user-sync?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success) {
      throw new Error('user-sync GET returned non-success');
    }
    const tier = data.data.subscriptionTier ?? 'free';
    const next: CachedSubscription = {
      tier,
      lastFetchedAtMs: Date.now(),
      serverConfirmed: true,
    };
    setCachedSubscription(next);
    return next;
  })().finally(() => {
    fetchesInFlight.delete(userId);
  });
  fetchesInFlight.set(userId, request);
  return request;
}

/**
 * [TEST ONLY -- remove in C6-later] Flip the current user's tier so paid/free
 * branches can be exercised before real IAP. Writes profiles server-side and
 * refreshes the local cache so both the server (reads profiles) and the client
 * (reads cache) see the change.
 */
export async function devSetTier(tier: 'free' | 'plus'): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return false;
  try {
    // The route is fail-closed; the shared secret (same value as the API's
    // DEV_TIER_SECRET) lets it work regardless of which anonymous account
    // the install happens to have. Only attached in dev builds.
    const secret = process.env.EXPO_PUBLIC_DEV_TIER_SECRET;
    await apiClient.post(
      '/api/dev/set-tier',
      { userId, tier },
      __DEV__ && secret ? { headers: { 'x-dev-tier-secret': secret } } : undefined,
    );
    setCachedSubscription({ tier, lastFetchedAtMs: Date.now(), serverConfirmed: true });
    return true;
  } catch {
    return false;
  }
}
