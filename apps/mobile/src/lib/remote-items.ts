/**
 * Runtime item catalog.
 *
 * Items are now fully generated into @novame/engine plus the mobile bundle's
 * per-item WebP map. The retired R2 `Items/` folder no longer exists, so these
 * compatibility exports deliberately stay local-only and perform no network
 * request. Existing consumers keep the same cache/matching call shape.
 */
import { ITEM_DICTIONARY, type ItemDictionary } from '@novame/engine';

export interface RemoteItem {
  id: string;
  name: string;
  bagsCategory: string;
  promptCategory?: string;
  keywords?: string[];
  imageKey?: string;
}

export function refreshRemoteItems(): Promise<boolean> {
  return Promise.resolve(true);
}

export function remoteItems(): RemoteItem[] {
  return [];
}

export function remoteItemDef(_id: string): RemoteItem | null {
  return null;
}

/** Retained for source compatibility; no current caller should request it. */
export function remoteImageUri(_id: string): string {
  return '';
}

export function mergedItemDictionary(): ItemDictionary {
  return ITEM_DICTIONARY;
}

export function itemDisplayName(id: string): string {
  return ITEM_DICTIONARY.items[id]?.displayName ?? id;
}

export function itemBagsCategory(id: string): string | null {
  return ITEM_DICTIONARY.items[id]?.bagsCategory ?? null;
}

export function remoteIdsForPromptCategory(_category: string): string[] {
  return [];
}
