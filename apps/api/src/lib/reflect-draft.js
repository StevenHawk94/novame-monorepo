import { createClient } from '@supabase/supabase-js'
import { matchItems } from '@novame/engine'

import { getMergedDictionary } from '@/lib/remote-items'
import { isUsableReflectMemoryCopy, runReflectCopy } from '@/lib/reflect-ai'

export const MAX_BODY_CHARS = 5000
export const MAX_ITEMS_PER_REFLECT_CATEGORY = 8

export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
export function isoWeek(dateStr) {
  const parts = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function resolveDraftInput(supabase, input) {
  const mode = input.mode === 'prompt' || input.mode === 'items' ? input.mode : 'typing'
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (body.length > MAX_BODY_CHARS) return { error: 'too_long' }
  if (mode === 'typing' && !body) return { error: 'empty' }

  const dictionary = await getMergedDictionary(supabase)
  let matches = []
  if (mode === 'typing') {
    const removed = new Set(Array.isArray(input.removedItemIds)
      ? input.removedItemIds.filter((value) => typeof value === 'string') : [])
    matches = matchItems(body, dictionary).filter((match) => !removed.has(match.itemId))
  } else {
    if (!Array.isArray(input.selectedItems) || input.selectedItems.length === 0) {
      return { error: 'empty' }
    }
    const seen = new Set()
    const categoryCounts = new Map()
    for (const selected of input.selectedItems.slice(0, 100)) {
      const itemId = typeof selected?.itemId === 'string' ? selected.itemId : ''
      if (!itemId || seen.has(itemId)) continue
      const item = dictionary.items[itemId]
      if (!item) return { error: 'unknown_item' }
      const category = item.category || 'Uncategorized'
      const count = (categoryCounts.get(category) || 0) + 1
      if (count > MAX_ITEMS_PER_REFLECT_CATEGORY) return { error: 'too_many_items_in_category' }
      categoryCounts.set(category, count)
      seen.add(itemId)
      matches.push({
        itemId,
        displayName: item.displayName,
        rarity: item.rarity,
        label: item.displayName,
        // Guided selection is explicitly associated with the optional context.
        // Free users may copy those exact words without an AI call.
        sourceExcerpt: body || '',
      })
    }
  }
  return { mode, body, matches }
}

function firstWords(value, maxWords = 30) {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!clean) return ''
  return clean.split(' ').slice(0, maxWords).join(' ').slice(0, 500)
}

export function createMemoryFallbacks({ body, matches }) {
  if (!body.trim()) return {}
  return Object.fromEntries(matches.map((item) => [
    item.itemId,
    firstWords(item.sourceExcerpt || body),
  ]).filter(([, value]) => value))
}

export async function createMemoryCopy({ body, matches, generateBunny }) {
  if (!body.trim() || matches.length === 0) return { memories: {}, bubble: null, usage: null }
  const fallbacks = createMemoryFallbacks({ body, matches })
  try {
    const copy = await runReflectCopy({
      journal: body,
      generateBunny,
      items: matches.map((item) => ({
        id: item.itemId,
        name: item.displayName,
        evidence: item.sourceExcerpt || '',
      })),
    })
    const memories = Object.fromEntries(matches.map((item) => {
      const generated = copy.data.items?.[item.itemId]
      return [
        item.itemId,
        isUsableReflectMemoryCopy(generated) ? generated : fallbacks[item.itemId] || '',
      ]
    }).filter(([, value]) => value))
    return {
      memories,
      bubble: copy.data.bunnyText || null,
      usage: copy,
      error: null,
    }
  } catch (error) {
    // A matched item always has deterministic source evidence. AI outages must
    // not turn a paid user's item into an empty or contradictory memory.
    return { memories: fallbacks, bubble: null, usage: null, error }
  }
}
