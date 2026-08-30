import { ITEM_DICTIONARY, applyRemoteItemManifest, isRemoteItemManifest } from '@novame/engine'

const R2_BASE = 'https://media.novameapp.com'
const cache = new Map()

export async function getRemoteItemManifest(version) {
  if (!version || version === '0') return null
  const cached = cache.get(version)
  if (cached && Date.now() - cached.at < 60_000) return cached.value
  try {
    const response = await fetch(`${R2_BASE}/Items/manifests/${encodeURIComponent(version)}.json`, {
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`item_manifest_http_${response.status}`)
    const value = await response.json()
    if (!isRemoteItemManifest(value) || value.version !== version) throw new Error('invalid_item_manifest')
    if (cache.size > 8) cache.clear()
    cache.set(version, { at: Date.now(), value })
    return value
  } catch (error) {
    if (cached) return cached.value
    throw error
  }
}

/** Old clients omit itemsVersion and retain the catalog they previewed. */
export async function getMergedDictionary(itemsVersion = '0') {
  return applyRemoteItemManifest(ITEM_DICTIONARY, await getRemoteItemManifest(itemsVersion))
}

export async function getLatestMergedDictionary() {
  try {
    const response = await fetch(`${R2_BASE}/content-version.json?v=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return ITEM_DICTIONARY
    const pointer = await response.json()
    return getMergedDictionary(String(pointer?.itemsVersion ?? '0'))
  } catch {
    return ITEM_DICTIONARY
  }
}
