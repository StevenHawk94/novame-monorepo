import art from '../generated/shop-art.json';

export const SHOP_CATEGORIES = [...Object.keys(art.categories), 'outfits'];
export const MAX_SHOP_PRICE = 1000000;
export function shopPreview(item) {
  const category = art.categories[item.category];
  if (!category) return null;
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
    if (!row || Array.isArray(row) || Object.keys(row).some(key => !['id', 'price', 'version'].includes(key))
      || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 160 || seen.has(row.id)
      || !Number.isSafeInteger(row.price) || row.price < 1 || row.price > MAX_SHOP_PRICE
      || !Number.isSafeInteger(row.version) || row.version < 0) return false;
    seen.add(row.id); return true;
  });
}
