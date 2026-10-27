/**
 * Runtime item catalog.
 *
 * Retains old display metadata only. Current Tap artwork is bundled; retired
 * remote diary artwork is intentionally no longer requested.
 */
import { ITEM_DISPLAY_CATALOG, type ItemDictionary } from '@novame/engine';
import { getCachedRemoteItemManifest } from './item-manifest-cache';

export interface RemoteItem {
  id: string;
  name: string;
  bagsCategory: string;
  imageKey?: string;
  rarity?: 'common' | 'uncommon' | 'rare';
  category?: string;
  promptCategory?: string;
}

export function remoteItems(): RemoteItem[] {
  return (getCachedRemoteItemManifest()?.items ?? []).map((item) => ({
    id: item.itemId,
    name: item.iconName,
    bagsCategory: item.bagsCategory ?? item.category,
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
  // Retired overlays must not revive old artwork from persisted metadata.
  return '';
}

let displayManifest: ReturnType<typeof getCachedRemoteItemManifest> | undefined;
let displayDictionary: ItemDictionary | undefined;
export function mergedItemDictionary(): ItemDictionary {
  // Compatibility display facade for historical journals and widgets.
  const manifest = getCachedRemoteItemManifest();
  if (displayDictionary && manifest === displayManifest) return displayDictionary;
  const items = manifest?.items.length ? { ...ITEM_DISPLAY_CATALOG } : ITEM_DISPLAY_CATALOG;
  for (const entry of manifest?.items ?? []) items[entry.itemId] = {
    displayName: entry.iconName, rarity: entry.rarity, category: entry.category,
    bagsCategory: entry.bagsCategory, emoji: entry.emoji,
  };
  displayManifest = manifest;
  displayDictionary = { items };
  return displayDictionary;
}

export function itemDisplayName(id: string): string {
  return remoteItemDef(id)?.name ?? ITEM_DISPLAY_CATALOG[id]?.displayName ?? id;
}

export function itemBagsCategory(id: string): string | null {
  return remoteItemDef(id)?.bagsCategory ?? ITEM_DISPLAY_CATALOG[id]?.bagsCategory ?? null;
}

export function remoteIdsForPromptCategory(_category: string): string[] {
  const wanted = _category.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return remoteItems().filter((item) => {
    const value = (item.promptCategory ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return value === wanted;
  }).map((item) => item.id);
}
