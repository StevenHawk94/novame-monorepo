import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from './app-major-update-api';
import { BURROW_SHOP_CATEGORIES, type BurrowShopCategory } from './burrow-shop-categories';

export type CollectionTab = 'items' | 'gifts' | 'friends';
export type CollectionFilter = 'all' | BurrowShopCategory;
export type CollectionEntry = {
  id: string; title: string; found: boolean; item?: MajorUpdateCatalogItem;
  friend?: MajorUpdateBootstrap['friends'][number]; origin?: string;
};
const isGift = (item: MajorUpdateCatalogItem) => item.tags.includes('adventure_v2_gift') || item.item_type === 'souvenir';
const isItem = (item: MajorUpdateCatalogItem) => item.category !== 'seasons' && !isGift(item)
  && !(item.category==='outfits'&&item.metadata.starter)
  && ['decor', 'outfit', 'our_room'].includes(item.item_type);

function prepareCollection(data: MajorUpdateBootstrap, ownerId: string) {
  const owned = new Set(data.inventory.filter(row => row.owner_id === ownerId).map(row => row.item_id));
  const gifts = data.catalog.filter(isGift);
  const items = data.catalog.filter(isItem);
  const friends = data.adventureCollection?.enabled
    ? data.friends.filter(friend => friend.stable_id.startsWith('adventure_friend_')) : data.friends;
  const met = new Set(data.discoveries.filter(row => row.user_id === ownerId && !!row.interaction_completed_at).map(row => row.friend_id));
  const categories = [...new Set(gifts.map(item => item.metadata.giftCategory).filter((value): value is string => !!value))].sort();
  const friendNames = new Map(data.friends.map(friend => [friend.stable_id, friend.name]));
  const rows = (catalog: MajorUpdateCatalogItem[], gift = false): CollectionEntry[] => catalog.map(item => ({
    id: item.stable_id, title: item.title, found: owned.has(item.stable_id), item,
    ...(gift ? { origin: friendNames.has(item.metadata.friendId ?? '') ? `From ${friendNames.get(item.metadata.friendId!)}` : 'From an adventure' } : {}),
  })).sort((a, b) => Number(b.found) - Number(a.found));
  const itemEntries = rows(items), giftEntries = rows(gifts, true);
  const friendEntries: CollectionEntry[] = friends.map(friend => ({ id: friend.stable_id, title: friend.name, found: met.has(friend.stable_id), friend }))
    .sort((a, b) => Number(b.found) - Number(a.found));
  const itemGroups = new Map<string, CollectionEntry[]>([['all', itemEntries], ...BURROW_SHOP_CATEGORIES.map(category =>
    [category, itemEntries.filter(entry => entry.item?.category === category)] as [string, CollectionEntry[]])]);
  const giftGroups = new Map<string | null, CollectionEntry[]>([[null, giftEntries], ...categories.map(category =>
    [category, giftEntries.filter(entry => entry.item?.metadata.giftCategory === category)] as [string, CollectionEntry[]])]);
  return { itemGroups, giftGroups, friendEntries, categories, totalFriends: friends.length,
    counts: { items: itemEntries.filter(entry => entry.found).length, gifts: giftEntries.filter(entry => entry.found).length,
      friends: friendEntries.filter(entry => entry.found).length } };
}

// Keep a small, identity-scoped memory cache across opening/closing the room.
// Wallet-only refreshes and tab changes reuse the exact arrays. Inventory or
// discoveries changing invalidates it, so newly claimed rewards appear.
type CachedCollection = ReturnType<typeof prepareCollection>;
const cache: { data: MajorUpdateBootstrap; ownerId: string; value: CachedCollection }[] = [];
export function collectionRoomModel(data: MajorUpdateBootstrap, ownerId: string,
  tab: CollectionTab, filter: CollectionFilter = 'all', giftCategory: string | null = null) {
  let cached = cache.find(row => row.ownerId === ownerId && row.data.catalog === data.catalog && row.data.inventory === data.inventory
    && row.data.friends === data.friends && row.data.discoveries === data.discoveries
    && row.data.adventureCollection?.enabled === data.adventureCollection?.enabled);
  if (!cached) { cached = { data, ownerId, value: prepareCollection(data, ownerId) }; cache.unshift(cached); cache.splice(3); }
  const value = cached.value;
  const selectedCategory = giftCategory && value.categories.includes(giftCategory) ? giftCategory : null;
  return { entries: tab === 'friends' ? value.friendEntries : tab === 'gifts' ? value.giftGroups.get(selectedCategory)!
    : value.itemGroups.get(filter) ?? value.itemGroups.get('all')!, categories: value.categories, selectedCategory,
    count: value.counts[tab], totalFriends: value.totalFriends };
}

export function collectionGridLayout(width: number, tab: CollectionTab) {
  const boardWidth = Math.min(width, 560) - 16;
  const columns = tab === 'friends' ? 3 : 4;
  const padding = 12, gap = 8;
  return { boardWidth, columns, padding, gap, cardWidth: (boardWidth - padding * 2 - gap * (columns - 1)) / columns };
}
