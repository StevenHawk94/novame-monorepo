import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchStoreSubscriptionPricing,
  type StoreSubscriptionPricing,
} from '@/lib/iap';

export type StorePricingStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Loads storefront-localized prices as soon as a paywall becomes relevant.
 * Concurrent callers share one request, while retry always performs a fresh
 * store lookup so a temporary StoreKit / Play Billing failure is recoverable.
 */
export function useStoreSubscriptionPricing(enabled = true) {
  const [pricing, setPricing] = useState<StoreSubscriptionPricing | null>(null);
  const [status, setStatus] = useState<StorePricingStatus>('idle');
  const requestRef = useRef<Promise<StoreSubscriptionPricing | null> | null>(null);

  const load = useCallback(async (force = false): Promise<StoreSubscriptionPricing | null> => {
    if (pricing && !force) return pricing;
    if (requestRef.current) return requestRef.current;

    setStatus('loading');
    const request = fetchStoreSubscriptionPricing()
      .then((nextPricing) => {
        setPricing(nextPricing);
        setStatus('ready');
        return nextPricing;
      })
      .catch((error) => {
        console.warn('[iap] storefront pricing unavailable:', error);
        setStatus('error');
        return null;
      })
      .finally(() => {
        requestRef.current = null;
      });

    requestRef.current = request;
    return request;
  }, [pricing]);

  useEffect(() => {
    if (enabled && status === 'idle') void load();
  }, [enabled, load, status]);

  const retry = useCallback(() => load(true), [load]);

  return { pricing, status, load, retry };
}
