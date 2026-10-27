import art from '../generated/shop-art.json';

export const SHOP_CATEGORIES = Object.keys(art.categories);
export const MAX_SHOP_PRICE = 1000000;
export function shopPreview(item) {
  if(item.stable_id&&art.products&&Object.hasOwn(art.products,item.stable_id))return art.products[item.stable_id].preview;
  if(item.metadata?.catalogManaged)return null;
  const category = art.categories[item.category];
  if (!category) return null;
  if (item.category === 'windows') return category.find(frame => frame?.windowFrameKey === item.metadata?.windowFrameKey) ?? null;
  // Frame identity survives insertions/reordering; never show another frame's
  // art simply because a retired catalog row still has an old ordinal.
  if (item.category === 'surprises') {
    const id = item.metadata?.frameId ?? item.stable_id?.replace(/^surprise:/, '');
    return category.find(frame => frame?.frameId === id) ?? null;
  }
  if (item.category === 'outfits' && item.metadata?.starter) return null;
  const ordinal = item.metadata?.starter ? 1 : item.metadata?.artOrdinal;
  // Unlike Home's compatibility fallback, Admin must expose mismatches.
  return Number.isInteger(ordinal) && ordinal > 0 ? category[ordinal - 1] ?? null : null;
}
export const shopAppVersion = art.appVersion;
export function validateShopPriceBatch(input) {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !['updates', 'reason'].includes(key))
    || !Array.isArray(input.updates) || input.updates.length < 1 || input.updates.length > 200
    || (input.reason != null && (typeof input.reason !== 'string' || input.reason.length > 500))) return false;
  const seen = new Set();
  return input.updates.every(row => {
    if (!row || Array.isArray(row) || Object.keys(row).some(key => !['id', 'price', 'plus_only', 'version'].includes(key))
      || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 160 || seen.has(row.id)
      || (!Object.hasOwn(row, 'price') && !Object.hasOwn(row, 'plus_only'))
      || (Object.hasOwn(row, 'price') && (!Number.isSafeInteger(row.price) || row.price < (row.id.startsWith('game:') ? 0 : 1) || row.price > MAX_SHOP_PRICE))
      || (Object.hasOwn(row, 'plus_only') && typeof row.plus_only !== 'boolean')
      || !Number.isSafeInteger(row.version) || row.version < 0) return false;
    seen.add(row.id); return true;
  });
}
