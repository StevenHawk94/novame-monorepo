import { ITEM_DICTIONARY, ITEM_CATALOG_VERSION, applyItemRules } from '@novame/engine'
import { getMergedDictionary } from './remote-items'
const cache = new Map()
export async function readItemRules(supabase, revision = null) {
  const key = revision == null ? 'latest' : String(revision)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < 60_000) return cached.value
  const { data, error } = await supabase.rpc('item_rule_snapshot', { p_catalog: ITEM_CATALOG_VERSION, p_revision: revision })
  if (error) throw error
  if (!data || data.catalog !== ITEM_CATALOG_VERSION || !Array.isArray(data.rules)) throw new Error('invalid_rule_snapshot')
  if (cache.size > 32) cache.clear()
  cache.set(key, { at: Date.now(), value: data })
  return data
}
export async function dictionaryForRevision(supabase, version) {
  // Old installed apps retain exactly the bundle rules they previewed.
  if (!version) return ITEM_DICTIONARY
  if (version.catalog !== ITEM_CATALOG_VERSION || !Number.isSafeInteger(version.revision) || version.revision < 0) throw new Error('invalid_rule_version')
  const base = await getMergedDictionary(typeof version.itemsVersion === 'string' ? version.itemsVersion : '0')
  if (version.revision === 0) return base
  const snapshot = await readItemRules(supabase, version.revision)
  return applyItemRules(base, snapshot.rules)
}
