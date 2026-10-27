import type { ItemDef, ItemDictionary } from './item-types';

export type RemoteItemEntry = Omit<ItemDef, 'displayName'> & {
  itemId: string;
  iconName: string;
  imageKey: string;
  assetVersion: string;
  replacesBundled: boolean;
  /** One of Reflect_Subcategory_Map's ten Main_Category values. */
  promptCategory?: string;
};

export interface RemoteItemManifest {
  schemaVersion: 1;
  version: string;
  baseCatalogVersion: string;
  publishedAt: string;
  items: RemoteItemEntry[];
}

export function isRemoteItemManifest(value: unknown): value is RemoteItemManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<RemoteItemManifest>;
  return manifest.schemaVersion === 1
    && typeof manifest.version === 'string'
    && typeof manifest.baseCatalogVersion === 'string'
    && typeof manifest.publishedAt === 'string'
    && Array.isArray(manifest.items)
    && manifest.items.every((item) => item && typeof item.itemId === 'string'
      && typeof item.iconName === 'string' && typeof item.imageKey === 'string'
      && typeof item.assetVersion === 'string' && typeof item.category === 'string'
      && ['common', 'uncommon', 'rare'].includes(String(item.rarity)));
}

/** Read old immutable manifests without carrying their retired rule payloads. */
export function projectItemDisplayManifest(manifest: RemoteItemManifest): RemoteItemManifest {
  return { schemaVersion: 1, version: manifest.version, baseCatalogVersion: manifest.baseCatalogVersion,
    publishedAt: manifest.publishedAt, items: manifest.items.map(item => ({
      itemId: item.itemId, iconName: item.iconName, imageKey: item.imageKey, assetVersion: item.assetVersion,
      category: item.category, rarity: item.rarity, replacesBundled: item.replacesBundled,
      ...(item.bagsCategory ? { bagsCategory: item.bagsCategory } : {}),
      ...(item.emoji ? { emoji: item.emoji } : {}),
      ...(item.visualConcept ? { visualConcept: item.visualConcept } : {}),
      ...(item.promptCategory ? { promptCategory: item.promptCategory } : {}),
    })) };
}

/**
 * Display-only overlay. Existing IDs and historical art remain available;
 * journal text is never inspected and no matching index is built.
 */
export function applyRemoteItemManifest(
  base: ItemDictionary,
  manifest: RemoteItemManifest | null | undefined,
): ItemDictionary {
  if (!manifest) return base;
  const items = { ...base.items };

  for (const entry of manifest.items) {
    items[entry.itemId] = {
      displayName: entry.iconName,
      rarity: entry.rarity,
      category: entry.category,
      ...(entry.bagsCategory ? { bagsCategory: entry.bagsCategory } : {}),
      ...(entry.emoji ? { emoji: entry.emoji } : {}),
      ...(entry.visualConcept ? { visualConcept: entry.visualConcept } : {}),
    };
  }
  return { items };
}
