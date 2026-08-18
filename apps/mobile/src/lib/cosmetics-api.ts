/**
 * Clovers balance + cosmetic unlocks (skins / scenes bought with clovers).
 * Cache-first like the other reads: render the cached state instantly, refresh
 * in the background. Purchases go through the server (it checks balance, Plus
 * gating, and ownership) and return the new balance, which we cache.
 */
import { kCosmeticUnlocks } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export const COSMETIC_PRICE = 500;

export interface CosmeticUnlock {
  type: 'skin' | 'scene' | 'outfit';
  id: string;
}

export interface CosmeticsState {
  balance: number;
  unlocks: CosmeticUnlock[];
}

type CosmeticsListener = (state: CosmeticsState) => void;
const listeners = new Set<CosmeticsListener>();
let cacheRevision = 0;

export function getCachedCosmetics(): CosmeticsState {
  const raw = storage.getString(kCosmeticUnlocks.name);
  if (!raw) return { balance: 0, unlocks: [] };
  try {
    const p = JSON.parse(raw) as Partial<CosmeticsState>;
    return { balance: p.balance ?? 0, unlocks: p.unlocks ?? [] };
  } catch {
    return { balance: 0, unlocks: [] };
  }
}

function write(s: CosmeticsState): void {
  storage.set(kCosmeticUnlocks.name, JSON.stringify(s));
  cacheRevision += 1;
  for (const listener of listeners) listener(s);
}

/** Subscribe to immediate balance/unlock changes without waiting for a refetch. */
export function subscribeCosmetics(listener: CosmeticsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Apply a server-confirmed Clover award to the cache and every visible total. */
export function awardCachedClovers(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const cur = getCachedCosmetics();
  write({ ...cur, balance: Math.max(0, Math.min(99999, cur.balance + Math.floor(amount))) });
}

/** Server confirmed an award: update instantly, then silently verify it. */
export function confirmCloverAward(amount: number): void {
  awardCachedClovers(amount);
  void fetchCosmetics();
}

/**
 * Paint an award immediately, then reconcile it when the background request
 * completes. Concurrent awards are safe because commit/rollback apply deltas
 * against the latest cache rather than restoring an old snapshot.
 */
export function optimisticCloverAward(expectedAmount: number): {
  commit: (actualAmount?: number) => void;
  rollback: () => void;
} {
  const expected = Math.max(0, Math.floor(expectedAmount));
  let settled = false;
  awardCachedClovers(expected);

  const adjust = (delta: number) => {
    if (delta === 0) return;
    const cur = getCachedCosmetics();
    write({ ...cur, balance: Math.max(0, Math.min(99999, cur.balance + delta)) });
  };

  return {
    commit(actualAmount = expected) {
      if (settled) return;
      settled = true;
      const actual = Math.max(0, Math.floor(actualAmount));
      adjust(actual - expected);
      void fetchCosmetics();
    },
    rollback() {
      if (settled) return;
      settled = true;
      adjust(-expected);
      void fetchCosmetics();
    },
  };
}

export async function fetchCosmetics(): Promise<CosmeticsState> {
  const revisionAtStart = cacheRevision;
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedCosmetics();
  try {
    const data = await apiClient.get<{ success?: boolean; balance?: number; unlocks?: CosmeticUnlock[] }>(
      `/api/cosmetics/unlocks?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success) return getCachedCosmetics();
    const state: CosmeticsState = { balance: data.balance ?? 0, unlocks: data.unlocks ?? [] };
    // Do not let an older in-flight refresh overwrite a newer optimistic
    // award. That award starts its own post-confirmation reconciliation.
    if (revisionAtStart !== cacheRevision) return getCachedCosmetics();
    write(state);
    return state;
  } catch {
    return getCachedCosmetics();
  }
}

export function isUnlocked(state: CosmeticsState, type: 'skin' | 'scene' | 'outfit', id: string): boolean {
  return state.unlocks.some((u) => u.type === type && u.id === id);
}

export type PurchaseResult =
  | { ok: true; balance: number }
  | { ok: false; error: 'insufficient' | 'plus_required' | 'already_owned' | 'network' };

/** Buy a cosmetic. On success, updates the cached balance + unlocks. */
export async function purchaseCosmetic(type: 'skin' | 'scene' | 'outfit', id: string): Promise<PurchaseResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string; balance?: number }>(
      '/api/cosmetics/purchase',
      { userId, cosmeticType: type, cosmeticId: id },
    );
    if (data.success) {
      const cur = getCachedCosmetics();
      write({ balance: data.balance ?? cur.balance, unlocks: [...cur.unlocks, { type, id }] });
      return { ok: true, balance: data.balance ?? 0 };
    }
    const err = data.error;
    if (err === 'insufficient' || err === 'plus_required' || err === 'already_owned') {
      return { ok: false, error: err };
    }
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}
