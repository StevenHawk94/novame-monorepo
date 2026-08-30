import type { ItemDef, ItemDictionary } from './item-matcher';

export type RemoteKeywordMode = 'AUTO' | 'AUTO_UNLESS_EXCLUDED' | 'NEVER_AUTO';
export type RemoteKeywordType = 'Word' | 'Phrase';

export interface RemoteKeywordSafety {
  keyword: string;
  triggerMode: RemoteKeywordMode;
  keywordType: RemoteKeywordType;
  exclusions?: string[];
}

export type RemoteItemEntry = Omit<ItemDef, 'displayName'> & {
  itemId: string;
  iconName: string;
  imageKey: string;
  assetVersion: string;
  keywordsMapping: string[];
  keywordSafety: RemoteKeywordSafety[];
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

const normalize = (value: string): string =>
  (value.toLowerCase().replace(/[’‘`´]/g, "'").match(/[a-z0-9']+/g) || []).join(' ');

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
      && ['common', 'uncommon', 'rare'].includes(String(item.rarity))
      && Array.isArray(item.keywordsMapping) && item.keywordsMapping.every((word) => typeof word === 'string')
      && Array.isArray(item.keywordSafety) && item.keywordSafety.every((safety) => safety
        && typeof safety.keyword === 'string'
        && ['AUTO', 'AUTO_UNLESS_EXCLUDED', 'NEVER_AUTO'].includes(safety.triggerMode)
        && ['Word', 'Phrase'].includes(safety.keywordType)
        && (safety.exclusions == null || (Array.isArray(safety.exclusions)
          && safety.exclusions.every((word) => typeof word === 'string')))));
}

/**
 * Apply the published remote overlay to the bundled catalog. Existing item IDs
 * are preserved, so replacing artwork/rules never breaks old memories. A
 * replacement owns its complete keyword set: bundled rules for that item are
 * removed before the reviewed remote rules are installed.
 */
export function applyRemoteItemManifest(
  base: ItemDictionary,
  manifest: RemoteItemManifest | null | undefined,
): ItemDictionary {
  if (!manifest) return base;
  const items = { ...base.items };
  const synonyms = { ...base.synonyms };
  const exclusions = { ...(base.exclusions ?? {}) };

  for (const entry of manifest.items) {
    if (entry.replacesBundled && items[entry.itemId]) {
      for (const [keyword, owner] of Object.entries(synonyms)) {
        if (owner === entry.itemId) {
          delete synonyms[keyword];
          delete exclusions[keyword];
        }
      }
    }
    items[entry.itemId] = {
      displayName: entry.iconName,
      rarity: entry.rarity,
      category: entry.category,
      ...(entry.bagsCategory ? { bagsCategory: entry.bagsCategory } : {}),
      ...(entry.emoji ? { emoji: entry.emoji } : {}),
      keywords: entry.keywordsMapping,
      ...(entry.visualConcept ? { visualConcept: entry.visualConcept } : {}),
    };
    for (const safety of entry.keywordSafety) {
      const keyword = normalize(safety.keyword);
      if (!keyword || safety.triggerMode === 'NEVER_AUTO') continue;
      synonyms[keyword] = entry.itemId;
      if (safety.triggerMode === 'AUTO_UNLESS_EXCLUDED' && safety.exclusions?.length) {
        exclusions[keyword] = safety.exclusions.map(normalize).filter(Boolean);
      } else {
        delete exclusions[keyword];
      }
    }
  }
  return { items, synonyms, exclusions };
}
