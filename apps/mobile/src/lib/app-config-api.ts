import { apiClient } from './api';
import { storage } from './storage';

/**
 * App config -- dynamic pricing + unlock thresholds.
 *
 * Source of truth: Supabase `app_config` table.
 * Read path: GET /api/app-config (CORS open, no auth).
 * Edit path: admin POST /api/admin/app-config (Stage A4, not yet wired).
 *
 * Mobile cache policy (per design Q3 = a + c):
 *   - Lazy: a consumer calls fetchAppConfig(); fresh cache returns instantly.
 *   - Display (product-detail / assets-view / payment-stub): read cache.
 *   - 1-hour TTL: refetch in background when expired.
 *   - payment-stub force-refresh: bypass TTL right before checkout so the
 *     displayed total always matches the server-charged amount.
 *
 * Fallback policy:
 *   - getCachedConfig() never returns null. On cache miss / parse fail
 *     it returns DEFAULT_CONFIG (the initial DB seed values).
 *   - This means first-launch / offline never blocks the UI with a
 *     "loading" placeholder for pricing -- users see the documented
 *     defaults immediately, swapped for live values once fetch lands.
 */

// ============================================================
// Types
// ============================================================

export type AppConfig = {
  printed_book_price: number;
  wisdom_cards_price: number;
  shipping_fee: number;
  book_unlock_words: number;
  cards_unlock_count: number;
};

type CacheRecord = {
  config: AppConfig;
  fetchedAt: number; // epoch ms
  updatedAt: string | null; // server-side latest updated_at across the 5 rows
};

type FetchResult =
  | { kind: 'success'; config: AppConfig; updatedAt: string | null }
  | { kind: 'error'; message: string };

// ============================================================
// Constants
// ============================================================

const STORAGE_KEY = 'novame_app_config';

/** 1 hour. Background refresh kicks in when cache.fetchedAt + this < now. */
const TTL_MS = 60 * 60 * 1000;

/**
 * Initial DB seed values. Used as fallback when:
 *   - First launch and no cache exists yet.
 *   - Network unreachable on the first fetch.
 *   - JSON parse fails for some reason.
 *
 * Keep in sync with the initial INSERT in app_config (Stage A1 SQL).
 * If you change the production defaults via admin, this file does NOT
 * need to update -- this only affects users with empty cache + no
 * network on first launch.
 */
export const DEFAULT_CONFIG: AppConfig = {
  printed_book_price: 99.99,
  wisdom_cards_price: 59.99,
  shipping_fee: 0,
  book_unlock_words: 20000,
  cards_unlock_count: 48,
};

// ============================================================
// Cache primitives
// ============================================================

function readCacheRecord(): CacheRecord | null {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheRecord;
    // Defensive: validate shape so a corrupted MMKV record can't crash UI.
    if (
      typeof parsed === 'object'
      && parsed !== null
      && typeof parsed.fetchedAt === 'number'
      && typeof parsed.config === 'object'
      && parsed.config !== null
      && typeof parsed.config.printed_book_price === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCacheRecord(config: AppConfig, updatedAt: string | null): void {
  const record: CacheRecord = {
    config,
    fetchedAt: Date.now(),
    updatedAt,
  };
  storage.set(STORAGE_KEY, JSON.stringify(record));
}

// ============================================================
// Public API
// ============================================================

/**
 * Synchronous cache read. Never returns null -- falls back to
 * DEFAULT_CONFIG when cache is missing or corrupt.
 *
 * Call this from render code. Pair with a one-shot fetchAppConfig()
 * elsewhere (e.g. in a useEffect) to refresh the cache.
 */
export function getCachedConfig(): AppConfig {
  const record = readCacheRecord();
  return record?.config ?? DEFAULT_CONFIG;
}

/**
 * Returns true when cache is older than TTL_MS, missing, or corrupt.
 */
export function isCacheStale(): boolean {
  const record = readCacheRecord();
  if (!record) return true;
  return Date.now() - record.fetchedAt > TTL_MS;
}

/**
 * Fetch latest config from server and update MMKV cache.
 *
 * Returns a result describing the outcome. Callers usually don't need
 * to inspect this -- the side effect (cache update) is what matters.
 *
 * Options:
 *   - noCache: when true, bypass any TTL check and always hit the
 *     network. Used by the payment-stub strict-refresh path right
 *     before showing the final price + creating the order.
 *
 *     When false (default), a fresh cached result is returned immediately.
 *     Concurrent stale reads share one request.
 */
let fetchInFlight: Promise<FetchResult> | null = null;

export async function fetchAppConfig(options?: {
  noCache?: boolean;
}): Promise<FetchResult> {
  type WireResponse = {
    success: boolean;
    config?: Partial<AppConfig>;
    updatedAt?: string | null;
    error?: string;
  };

  const cached = readCacheRecord();
  if (!options?.noCache && cached && Date.now() - cached.fetchedAt <= TTL_MS) {
    return { kind: 'success', config: cached.config, updatedAt: cached.updatedAt };
  }
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const data = await apiClient.get<WireResponse>('/api/app-config');
      if (!data.success || !data.config) {
        return { kind: 'error', message: data.error || 'Failed to load config' };
      }

      // Defensive merge: any missing key falls back to DEFAULT_CONFIG.
      // This means a partial server response (corrupt single row, etc)
      // never poisons the local cache with NaN/undefined.
      const merged: AppConfig = {
        printed_book_price:
          typeof data.config.printed_book_price === 'number'
            ? data.config.printed_book_price
            : DEFAULT_CONFIG.printed_book_price,
        wisdom_cards_price:
          typeof data.config.wisdom_cards_price === 'number'
            ? data.config.wisdom_cards_price
            : DEFAULT_CONFIG.wisdom_cards_price,
        shipping_fee:
          typeof data.config.shipping_fee === 'number'
            ? data.config.shipping_fee
            : DEFAULT_CONFIG.shipping_fee,
        book_unlock_words:
          typeof data.config.book_unlock_words === 'number'
            ? data.config.book_unlock_words
            : DEFAULT_CONFIG.book_unlock_words,
        cards_unlock_count:
          typeof data.config.cards_unlock_count === 'number'
            ? data.config.cards_unlock_count
            : DEFAULT_CONFIG.cards_unlock_count,
      };

      writeCacheRecord(merged, data.updatedAt ?? null);
      return { kind: 'success', config: merged, updatedAt: data.updatedAt ?? null };
    } catch (e) {
      return {
        kind: 'error',
        message: e instanceof Error ? e.message : 'Network error',
      };
    } finally {
      fetchInFlight = null;
    }
  })();
  return fetchInFlight;
}

/**
 * Clears the cached config. Called from the sign-out handler so the
 * next signed-in session (which could be a different user / different
 * tier) does not see the previous session's prices for one frame.
 *
 * Strictly speaking app config is per-app not per-user, but we clear
 * defensively to keep cache hygiene uniform across all MMKV keys.
 */
export function clearCachedConfig(): void {
  storage.remove(STORAGE_KEY);
}
