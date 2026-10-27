import bundled from '../../../../packages/domain/src/generated/shop-catalog-release.json'

const categories = new Set(bundled.categories)
const capabilitySets = new Map(Object.entries(bundled.clients).map(([release, ids]) => [release, new Set(ids)]))
export function shopClientRelease(request) {
  const value = request?.headers?.get?.('x-burrow-catalog')
  return capabilitySets.has(value) ? value : bundled.legacyRelease
}
export function shopItemSupported(id, request) {
  return !!bundled.products[id] && capabilitySets.get(shopClientRelease(request)).has(id)
}
export function shopClientCanUseLegacy(request) {
  const legacy=capabilitySets.get(bundled.legacyRelease)
  return [...capabilitySets.get(shopClientRelease(request))].every(id=>legacy.has(id))
}
export function shopCatalogForClient(catalog, request) {
  const supported = capabilitySets.get(shopClientRelease(request))
  return (catalog ?? []).filter(item => !categories.has(item.category) || supported.has(item.stable_id))
}

/** Bootstrap contains active products only. Historical ownership/receipts stay
 * in the database, but retired art no longer has a runtime placement path. */
export async function projectShopCatalog(db, snapshot, request) {
  if (!snapshot || snapshot.error) return snapshot
  const catalog = shopCatalogForClient(snapshot.catalog, request)
  const ids = new Set(catalog.map(item => item.stable_id))
  const references = new Set([
    ...(snapshot.inventory ?? []).map(row => row.item_id),
    ...(snapshot.loadouts ?? []).map(row => row.item_id),
    ...(snapshot.gifts ?? []).map(row => row.item_id),
    snapshot.adventureResult?.metadata?.treasureSnapshot?.stable_id,
    snapshot.adventureResult?.reward_item_id,
  ].filter(id => id && !ids.has(id) && shopItemSupported(id, request)))
  const missing = [...references]
  for (let at = 0; at < missing.length; at += 100) {
    const {data, error} = await db.from('catalog_items').select('*').in('stable_id', missing.slice(at, at + 100))
    if (error) throw error
    catalog.push(...(data ?? []).filter(item => item.status === 'active'))
  }
  return {...snapshot, catalog, shopCatalogRelease: bundled.release}
}
export const LEGACY_SHOP_RELEASE = bundled.legacyRelease
