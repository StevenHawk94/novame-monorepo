/**
 * apps/api/src/lib/remote-items.js — server half of OTA items (2026-08-08).
 *
 * The mobile bundle ships the first item batch; later items live on R2
 * (Items/items-manifest.json + Items/<id>.webp). This module mirrors the
 * client merge for the SERVER's three jobs:
 *   1. text matching (reflect typing flow) sees remote keywords;
 *   2. picked-item validation accepts remote ids;
 *   3. the `items` table gains a row per new id (user_items/item_memories
 *      FK-reference it), upserted lazily on manifest refresh.
 *
 * 60s TTL in-memory cache per serverless instance, same pattern as the
 * cosmetics manifest.
 */
import { ITEM_DICTIONARY } from '@novame/engine'

const MANIFEST_URL = 'https://media.novameapp.com/Items/items-manifest.json'
const TTL_MS = 60_000

let cache = { at: 0, merged: null, upserted: false }

/**
 * The merged dictionary { items, synonyms } — bundled entries win over remote
 * ones on any collision. Falls back to the bundled dictionary alone whenever
 * the manifest is missing/unreachable.
 */
export async function getMergedDictionary(supabase) {
  const now = Date.now()
  if (cache.merged && now - cache.at < TTL_MS) return cache.merged

  let remote = []
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.items)) {
        remote = data.items.filter(
          (it) => it && typeof it.id === 'string' && typeof it.name === 'string',
        )
      }
    }
  } catch {
    // unreachable manifest → bundled-only
  }

  if (remote.length === 0) {
    cache = { at: now, merged: ITEM_DICTIONARY, upserted: cache.upserted }
    return ITEM_DICTIONARY
  }

  const items = { ...ITEM_DICTIONARY.items }
  const synonyms = { ...ITEM_DICTIONARY.synonyms }
  const exclusions = { ...(ITEM_DICTIONARY.exclusions ?? {}) }
  for (const it of remote) {
    if (!items[it.id]) {
      items[it.id] = {
        displayName: it.name,
        bagsCategory: it.bagsCategory ?? 'Stuff',
        rarity: 'common',
      }
    }
    for (const kw of Array.isArray(it.keywords) ? it.keywords : []) {
      const key = String(kw).trim().toLowerCase()
      if (key && !synonyms[key]) synonyms[key] = it.id
    }
  }
  const merged = { items, synonyms, exclusions }
  cache = { at: now, merged, upserted: cache.upserted }

  // Lazy self-healing: make sure every remote id exists in the items table
  // (FK target for user_items/item_memories). Once per instance lifetime.
  if (supabase && !cache.upserted) {
    cache.upserted = true
    const rows = remote.map((it) => ({
      id: it.id,
      sheet_id: 'remote',
      row: 0,
      col: 0,
      display_name: it.name,
      rarity: 'common',
      category: it.bagsCategory ?? 'Stuff',
    }))
    supabase
      .from('items')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      .then(({ error }) => {
        if (error) {
          console.warn('[remote-items] items upsert failed:', error.message)
          cache.upserted = false // retry on a later refresh
        }
      })
  }

  return merged
}
