import { describe, expect, it } from 'vitest';
import { applyRemoteItemManifest, isRemoteItemManifest, projectItemDisplayManifest } from './remote-manifest';
import type { ItemDictionary } from './item-types';
import { ITEM_DISPLAY_CATALOG } from './display-catalog';
const base: ItemDictionary = { items: { coffee: { displayName: 'Coffee', rarity: 'common', category: 'Food' } } };
const old = { schemaVersion: 1 as const, version: 'v1', baseCatalogVersion: 'base', publishedAt: '2026-08-30',
  items: [{ itemId: 'remote.old', iconName: 'Historical remote', imageKey: 'Items/old.webp', assetVersion: 'v',
    category: 'Object', rarity: 'rare' as const, replacesBundled: false,
    keywordsMapping: ['private phrase'], keywordSafety: [{ keyword: 'private phrase', triggerMode: 'AUTO' }] }] };
describe('display-only historical catalog', () => {
  it('preserves all 5439 historical IDs and five manual people IDs', () => {
    expect(Object.keys(ITEM_DISPLAY_CATALOG)).toHaveLength(5651);
    expect(ITEM_DISPLAY_CATALOG['memory.0002_coffee'].displayName).toBe('Coffee');
    expect(ITEM_DISPLAY_CATALOG['memory.5440_water_heater'].displayName).toBe('Water Heater');
    expect(ITEM_DISPLAY_CATALOG['tap.person.partner'].displayName).toBe('Partner');
    for (const item of Object.values(ITEM_DISPLAY_CATALOG)) {
      expect(item.displayName).toBeTruthy();
      expect(item).not.toHaveProperty('keywords');
    }
  });
  it('accepts old manifests but projects out all matching fields', () => {
    expect(isRemoteItemManifest(old)).toBe(true);
    const display = projectItemDisplayManifest(old);
    expect(display.items[0]).not.toHaveProperty('keywordsMapping');
    expect(display.items[0]).not.toHaveProperty('keywordSafety');
    expect(display.items[0].imageKey).toBe('Items/old.webp');
    expect(display.items[0].itemId).toBe('remote.old');
    const merged = applyRemoteItemManifest(base, display);
    expect(merged.items.coffee.displayName).toBe('Coffee');
    expect(merged.items['remote.old'].displayName).toBe('Historical remote');
    expect(merged).not.toHaveProperty('synonyms');
    expect(base.items).not.toHaveProperty('remote.old');
  });
});
