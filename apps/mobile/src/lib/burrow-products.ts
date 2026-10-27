import type { MajorUpdateCatalogItem } from './app-major-update-api';

export type BurrowProduct = { price: number; plus_only: boolean; active: boolean };
/** Bootstrap's complete, revision-scoped Admin catalogue is the ONLY mobile
 * price source. Missing rows are unavailable, never a guessed coin offer. */
export function burrowProducts(catalog: MajorUpdateCatalogItem[], type: 'game' | 'surprise'): Record<string, BurrowProduct> {
  return Object.fromEntries(catalog.filter(item => item.item_type === type&&(item.status==null||item.status==='active')
    && Number.isInteger(item.price) && item.price! >= 0 && typeof item.plus_only === 'boolean')
    .map(item => [item.stable_id.replace(new RegExp(`^${type}:`), ''),
      { price: item.price!, plus_only: item.plus_only, active: true }]));
}
