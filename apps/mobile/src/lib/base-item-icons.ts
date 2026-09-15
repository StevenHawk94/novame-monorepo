import { ITEM_CATALOG_VERSION, ITEM_DICTIONARY } from '@novame/engine';

const R2_BASE = 'https://media.novameapp.com';
const BASE_ICON_PREFIX = `${R2_BASE}/Items/base-icons/${encodeURIComponent(ITEM_CATALOG_VERSION)}/`;
const baseIdSet = new Set(Object.keys(ITEM_DICTIONARY.items));

/** Immutable URL for one icon in the shipped base matching catalog. */
export function baseItemIconUrl(itemId: string): string {
  if (!baseIdSet.has(itemId)) return '';
  return `${BASE_ICON_PREFIX}${encodeURIComponent(itemId)}.webp`;
}

export function isBaseItemIconUrl(url: string): boolean {
  return url.startsWith(BASE_ICON_PREFIX);
}
