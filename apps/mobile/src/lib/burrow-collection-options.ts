import type { MajorUpdateCatalogItem } from './app-major-update-api';

/** Collection reuses Shop's decorator, but may only expose this owner's items. */
export function decorationOptions(
  catalog: readonly MajorUpdateCatalogItem[],
  category: string,
  ownedOnly: boolean,
  ownerId: string,
  inventory: readonly { owner_id: string; item_id: string }[],
): MajorUpdateCatalogItem[] {
  const owned = ownedOnly ? new Set(inventory.filter(row => row.owner_id === ownerId).map(row => row.item_id)) : null;
  return catalog.filter(item => item.category === category &&
    (owned ? owned.has(item.stable_id) : item.price != null || !!item.metadata.starter))
    .sort((a, b) => (a.metadata.artOrdinal ?? 0) - (b.metadata.artOrdinal ?? 0));
}
