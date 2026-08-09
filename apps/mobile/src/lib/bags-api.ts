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

import { kBagsState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export interface ItemMemory {
  excerpt: string;
  rawExcerpt: string;
  reflectId: string;
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

export function getCachedBags(): CollectedItem[] {
  const raw = storage.getString(kBagsState.name);
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as WireItem[]).map(decorate);
  } catch {
    return [];
  }
}

/** Fetch collected items, refreshing the cache. Cache stores the wire shape
 *  (ids only), decorated on read, so a dictionary edit reflects immediately. */
export async function fetchBags(): Promise<CollectedItem[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedBags();

  try {
    const data = await apiClient.get<{ success?: boolean; items?: WireItem[] }>(
      `/api/bags?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success || !data.items) return getCachedBags();
    storage.set(kBagsState.name, JSON.stringify(data.items));
    return data.items.map(decorate);
  } catch {
    return getCachedBags();
  }
}

export const RARITY_COLOR: Record<ItemRarity, string> = {
  common: '#9B8FBF',
  uncommon: '#5B9BD5',
  rare: '#E0A030',
};
