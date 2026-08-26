import { useSyncExternalStore } from 'react';
import type { PricingTierKey } from '@novame/core';
import {
  getCachedSubscriptionTier,
  getCachedSubscriptionTierState,
  subscribeToSubscriptionTier,
} from './subscription';

/** Reactive view of the existing subscription cache. The cache policy remains
 * owned by subscription.ts; this hook only repaints mounted Plus gates when an
 * authoritative entitlement refresh changes the cached tier. */
export function useSubscriptionTier(): PricingTierKey {
  return useSyncExternalStore(
    subscribeToSubscriptionTier,
    getCachedSubscriptionTier,
    getCachedSubscriptionTier,
  );
}

/** Null means the local entitlement cache is still hydrating. This is kept
 * separate from useSubscriptionTier so existing gates retain their fail-closed
 * Free default. */
export function useSubscriptionTierState(): PricingTierKey | null {
  return useSyncExternalStore(
    subscribeToSubscriptionTier,
    getCachedSubscriptionTierState,
    getCachedSubscriptionTierState,
  );
}
