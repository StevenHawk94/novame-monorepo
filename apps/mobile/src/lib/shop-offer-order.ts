/** Free first, then Plus; ascending authoritative price inside each group.
 * Equal prices retain the caller's editorial order (Array#sort is stable).
 * Missing prices are never treated as free offers. */
export function compareShopOffers(
  a: { price?: number | null; plus_only?: boolean },
  b: { price?: number | null; plus_only?: boolean },
): number {
  const access = Number(!!a.plus_only) - Number(!!b.plus_only);
  if (access) return access;
  const price = (offer: typeof a) => typeof offer.price === 'number' && Number.isFinite(offer.price)
    ? offer.price : Number.MAX_SAFE_INTEGER;
  return price(a) - price(b);
}
