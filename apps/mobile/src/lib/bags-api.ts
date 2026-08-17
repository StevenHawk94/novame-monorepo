/**
 * Bags data: collected items joined with their display info.
 *
 * The server returns only item_ids, counts, and memories; the display info
 * (name, rarity, emoji placeholder) comes from the shared dictionary in
 * @novame/engine, looked up by id. So the emoji swaps to sprite art by editing
 * the dictionary, with no API or client-shape change.
 */
import { ITEM_DICTIONARY, type ItemRarity } from '@novame/engine';
import { remoteItemDef } from './remote-items';

import { kBagsState, kTheirBagsState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export interface ItemMemory {
  excerpt: string;
  rawExcerpt: string;
  reflectId?: string;
  createdAt: string;
}

export interface CollectedItem {
  itemId: string;
  displayName: string;
  rarity: ItemRarity;
  emoji: string;
  category: string;
  count: number;
  firstSeenAt: string;
  memories: ItemMemory[];
}

interface WireItem {
  itemId: string;
  count: number;
  firstSeenAt: string;
  memories: ItemMemory[];
}

/** Join a server item with its dictionary display info. Unknown ids (dictionary
 *  edited since) fall back to a generic label so nothing crashes. */
function decorate(w: WireItem): CollectedItem {
  const def = ITEM_DICTIONARY.items[w.itemId];
  return {
    itemId: w.itemId,
    displayName: def?.displayName ?? remoteItemDef(w.itemId)?.name ?? w.itemId,
    rarity: def?.rarity ?? 'common',
    emoji: def?.emoji ?? '\ud83d\udce6',
    category: def?.category ?? 'other',
    count: w.count,
    firstSeenAt: w.firstSeenAt,
    memories: w.memories,
  };
}

/** Present rows from a pair's shared memory box using the same collection
 * shape as Bags. Repeated item ids become one tile with multiple memories. */
export function sharedBoxToCollectedItems(
  rows: { itemId: string; description: string; createdAt: string }[],
): CollectedItem[] {
  const grouped = new Map<string, WireItem>();
  for (const row of rows) {
    const current = grouped.get(row.itemId);
    const memory: ItemMemory = {
      excerpt: row.description,
      rawExcerpt: row.description,
      createdAt: row.createdAt,
    };
    if (current) {
      current.count += 1;
      current.memories.push(memory);
      if (row.createdAt > current.firstSeenAt) current.firstSeenAt = row.createdAt;
    } else {
      grouped.set(row.itemId, {
        itemId: row.itemId,
        count: 1,
        firstSeenAt: row.createdAt,
        memories: [memory],
      });
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    .map(decorate);
}

export function getCachedBags(): CollectedItem[] {
  const raw = storage.getString(kBagsState.name);
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as WireItem[]).map(decorate);
  } catch {
    return [];
  }
}

interface TheirBagsCache {
  ownerUserId: string | null;
  items: WireItem[];
}

export function getCachedTheirBags(expectedOwnerUserId?: string): CollectedItem[] {
  const raw = storage.getString(kTheirBagsState.name);
  if (!raw) return [];
  try {
    const cached = JSON.parse(raw) as TheirBagsCache;
    if (!Array.isArray(cached.items)) return [];
    if (expectedOwnerUserId && cached.ownerUserId !== expectedOwnerUserId) return [];
    return cached.items.map(decorate);
  } catch {
    return [];
  }
}

/** Fetch collected items, refreshing the cache. Cache stores the wire shape
 *  (ids only), decorated on read, so a dictionary edit reflects immediately. */
export async function fetchBags(
  scope: 'mine' | 'their' = 'mine',
  expectedOwnerUserId?: string,
): Promise<CollectedItem[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();

  try {
    const data = await apiClient.get<{
      success?: boolean;
      ownerUserId?: string | null;
      items?: WireItem[];
    }>(
      `/api/bags?userId=${encodeURIComponent(userId)}&scope=${scope}`,
    );
    if (!data.success || !data.items) return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();

    // Mine must belong to the signed-in account; Their must never come back
    // with that same owner. Reject a stale/mismatched API response instead of
    // painting it under the wrong tab.
    if (scope === 'mine' && data.ownerUserId && data.ownerUserId !== userId) return getCachedBags();
    if (scope === 'their' && data.ownerUserId === userId) return getCachedTheirBags(expectedOwnerUserId);
    if (scope === 'their' && expectedOwnerUserId && data.ownerUserId !== expectedOwnerUserId) {
      return getCachedTheirBags(expectedOwnerUserId);
    }

    if (scope === 'mine') storage.set(kBagsState.name, JSON.stringify(data.items));
    if (scope === 'their') {
      storage.set(kTheirBagsState.name, JSON.stringify({
        ownerUserId: data.ownerUserId ?? null,
        items: data.items,
      } satisfies TheirBagsCache));
    }
    return data.items.map(decorate);
  } catch {
    return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
  }
}

export const RARITY_COLOR: Record<ItemRarity, string> = {
  common: '#9B8FBF',
  uncommon: '#5B9BD5',
  rare: '#E0A030',
};
