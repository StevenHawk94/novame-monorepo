/**
 * Runtime item catalog.
 *
 * The bundled catalog remains the offline baseline. Admin-published additions
 * and replacements arrive as an immutable R2 overlay; matching rules and image
 * URLs switch together only after a complete manifest is cached.
 */
import type { ItemDictionary } from '@novame/engine';
import { itemRuleContext, refreshItemRules } from './item-rule-cache';
import { getCachedRemoteItemManifest, remoteItemAssetUrl } from './item-manifest-cache';

export interface RemoteItem {
  id: string;
  name: string;
  bagsCategory: string;
  keywords?: string[];
  imageKey?: string;
  rarity?: 'common' | 'uncommon' | 'rare';
  category?: string;
  promptCategory?: string;
}

/**
 * These bundled feeling icons were deliberately replaced together in the app
 * bundle. A device may still retain an older immutable R2 item manifest from a
 * previous release; allowing that overlay to win would make My Logs, Memories,
 * Paired, and the native widgets disagree with Tap Your Day. Keep only the art
 * local for this reviewed range. Remote matching rules and every other remote
 * item continue to work normally.
 */
const BUNDLED_FEELING_ART_START = 5355;
const BUNDLED_FEELING_ART_END = 5384;

function usesReviewedBundledFeelingArt(itemId: string): boolean {
  const match = /^memory\.(\d{4})_/.exec(itemId);
  if (!match) return false;
  const number = Number(match[1]);
  return number >= BUNDLED_FEELING_ART_START && number <= BUNDLED_FEELING_ART_END;
}

export function refreshRemoteItems(): Promise<boolean> {
  return refreshItemRules();
}

export function remoteItems(): RemoteItem[] {
  return (getCachedRemoteItemManifest()?.items ?? []).map((item) => ({
    id: item.itemId,
    name: item.iconName,
    bagsCategory: item.bagsCategory ?? item.category,
    keywords: item.keywordsMapping,
    imageKey: item.imageKey,
    rarity: item.rarity,
    category: item.category,
    promptCategory: item.promptCategory,
  }));
}

export function remoteItemDef(_id: string): RemoteItem | null {
  return remoteItems().find((item) => item.id === _id) ?? null;
}

/** Retained for source compatibility; no current caller should request it. */
export function remoteImageUri(_id: string): string {
  if (usesReviewedBundledFeelingArt(_id)) return '';
  const item = getCachedRemoteItemManifest()?.items.find((entry) => entry.itemId === _id);
  return item ? remoteItemAssetUrl(item.imageKey, item.assetVersion) : '';
}

export function mergedItemDictionary(): ItemDictionary {
  return itemRuleContext().dictionary;
}

export function itemDisplayName(id: string): string {
  return itemRuleContext().dictionary.items[id]?.displayName ?? id;
}

export function itemBagsCategory(id: string): string | null {
  return itemRuleContext().dictionary.items[id]?.bagsCategory ?? null;
}

export function remoteIdsForPromptCategory(_category: string): string[] {
  const wanted = _category.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return remoteItems().filter((item) => {
    const value = (item.promptCategory ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return value === wanted;
  }).map((item) => item.id);
}
