import { useSyncExternalStore } from 'react';
import type { PricingTierKey } from '@novame/core';
import {
  getCachedSubscriptionTier,
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
