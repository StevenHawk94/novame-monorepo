import { Platform } from 'react-native';
import { fetchProducts, getStorefront } from 'expo-iap';
import { storage } from './storage';
import { kCoinStorePrices } from '../shared/storage/keys';

export const CARROT_PRODUCTS = ['burrow.coin.200', 'burrow.coin.400', 'burrow.coin.1000'] as const;
const FRESH_MS = 5 * 60_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
type Prices = Record<string, string>;
type Cache = { platform: string; storefront: string; savedAt: number; prices: Prices };
let cache: Cache | null = null;
let flight: Promise<Prices> | null = null;

// Official localized display prices only. No user data, balances, or readiness
// flags are persisted here. The store sheet remains the final price authority.
export function cachedCoinPrices(): Prices {
  if (!cache) {
    try {
      const value = JSON.parse(storage.getString(kCoinStorePrices.name) ?? 'null');
      if (value?.platform === Platform.OS && typeof value.storefront === 'string'
        && Number.isFinite(value.savedAt) && value.savedAt <= Date.now()
        && Date.now() - value.savedAt < MAX_AGE_MS && value.prices) {
        const prices = Object.fromEntries(CARROT_PRODUCTS.filter(id => typeof value.prices[id] === 'string'
          && value.prices[id].length > 0 && value.prices[id].length < 100).map(id => [id, value.prices[id]]));
        cache = { ...value, prices };
      }
    } catch { /* Missing/corrupt cache: use a real store query, never a fake USD price. */ }
  }
  if (cache && Date.now() - cache.savedAt >= MAX_AGE_MS) cache = null;
  return cache?.prices ?? {};
}

/** Called only after initConnection; startup, reopen, and retry share one query. */
export function loadCoinPrices(force = false): Promise<Prices> {
  if (flight) return flight;
  cachedCoinPrices();
  flight = (async () => {
    let storefront = '';
    try { storefront = await getStorefront(); } catch { /* Offline: preserve last known country. */ }
    if (cache && storefront && cache.storefront !== storefront) {
      cache = null;
      try { storage.remove(kCoinStorePrices.name); } catch { /* Cache writes are best effort. */ }
    }
    if (!force && cache && Date.now() - cache.savedAt < FRESH_MS) return cache.prices;
    // Product lookup does not require login or a server preflight. Checkout
    // still checks the authenticated server's gate before opening payment.
    const products = await fetchProducts({ skus: [...CARROT_PRODUCTS], type: 'in-app' });
    const prices = Object.fromEntries((products ?? []).filter(p => CARROT_PRODUCTS.some(id => id === p.id)
      && p.displayPrice).map(p => [p.id, p.displayPrice]));
    if (!Object.keys(prices).length) throw new Error('Store products could not be loaded. Please retry.');
    cache = { platform: Platform.OS, storefront: storefront || cache?.storefront || '', savedAt: Date.now(), prices };
    try { storage.set(kCoinStorePrices.name, JSON.stringify(cache)); } catch { /* Memory cache still works. */ }
    return prices;
  })().finally(() => { flight = null; });
  return flight;
}

export function prewarmCoinPrices(): void {
  if (!['ios', 'android'].includes(Platform.OS)) return;
  void loadCoinPrices().catch(() => { /* Shop provides explicit retry; startup must stay nonblocking. */ });
}
