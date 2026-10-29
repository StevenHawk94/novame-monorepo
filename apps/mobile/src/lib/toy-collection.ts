import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from './app-major-update-api';
import { BURROW_ART, burrowArtForItem } from './burrow-art-assets';
import { SHOP_PRODUCT_IDS } from './generated/shop-product-art';
import { roomSlots } from './burrow-presentation';
import { compareShopOffers } from './shop-offer-order';

export function toyCatalog(data: MajorUpdateBootstrap): MajorUpdateCatalogItem[] {
  return data.catalog.filter(item => (item.status==null||item.status==='active')&&item.category === 'couple_dolls' && item.item_type === 'decor' &&
    item.metadata.slot === 'couple_doll' && !item.is_placeholder &&
    !!burrowArtForItem(item) && (SHOP_PRODUCT_IDS.has(item.stable_id) ||
      (!item.metadata.catalogManaged && !!BURROW_ART.couple_dolls[(item.metadata.artOrdinal??1)-1])))
    .sort((a, b) => Number(!!b.metadata.starter) - Number(!!a.metadata.starter) ||
      (a.metadata.artOrdinal ?? 1) - (b.metadata.artOrdinal ?? 1) || a.stable_id.localeCompare(b.stable_id));
}

/** Personal ownership only: a partner's purchase is not this user's collection. */
export function toyCollectionItems(data: MajorUpdateBootstrap) {
  const owned = new Set(data.inventory.filter(row => row.owner_id === data.profile.id).map(row => row.item_id));
  const catalog = toyCatalog(data);
  const starter = catalog.find(item => item.metadata.starter)?.stable_id;
  return catalog.filter(item => item.stable_id === starter || owned.has(item.stable_id));
}

export function toyShopItems(data: MajorUpdateBootstrap) {
  const owned = new Set(toyCollectionItems(data).map(item => item.stable_id));
  return toyCatalog(data).filter(item => (item.status==null||item.status==='active')&&!owned.has(item.stable_id) && item.price != null && item.price > 0)
    .sort(compareShopOffers);
}

/** Existing save API replaces the room: always carry every other decoration. */
export function toyRoomLoadout(data: MajorUpdateBootstrap, itemId: string) {
  if (!toyCollectionItems(data).some(item => item.stable_id === itemId)) throw Error('item_not_owned');
  const slots = Object.fromEntries(Object.entries(roomSlots(data, data.profile.id))
    .filter(([, item]) => item.item_type === 'decor' && !!item.metadata.slot)
    .map(([slot, item]) => [slot, item.stable_id]));
  return { ...slots, couple_doll: itemId };
}

export const toyScope = (data: MajorUpdateBootstrap) => `${data.profile.id}:${data.partner?.id ?? ''}:${data.pairVersion ?? ''}`;
