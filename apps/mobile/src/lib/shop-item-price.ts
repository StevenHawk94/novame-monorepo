import type { MajorUpdateCatalogItem } from './app-major-update-api';

/** Ownership wins over entitlement. Plus members see the actual coin price. */
export function shopItemPrice(item: Pick<MajorUpdateCatalogItem,'price'|'plus_only'>, hasPlus: boolean, owned: boolean) {
  if (owned) return { kind: 'owned' as const, label: 'Owned' };
  if (item.plus_only && !hasPlus) return { kind: 'plus' as const, label: 'Plus exclusive' };
  return { kind: 'price' as const, price: item.price, label: item.price == null ? '—' : `${item.price.toLocaleString()} coins` };
}
