/** Deterministic local classification for AI-extracted visual concepts. */
function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function tokens(value) {
  return new Set(normalize(value).split(' ').filter((part) => part.length > 1))
}

function similarity(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.82
  const aa = tokens(na)
  const bb = tokens(nb)
  let overlap = 0
  for (const token of aa) if (bb.has(token)) overlap += 1
  return overlap ? (2 * overlap) / (aa.size + bb.size) : 0
}

function classifyConcept(concept, dictionary, alreadyMatchedIds) {
  const normalized = normalize(concept)
  if (!normalized || normalized.length > 80) return null
  const directId = dictionary.synonyms?.[normalized]
  if (directId || alreadyMatchedIds.has(directId)) return null

  let best = null
  for (const [itemId, def] of Object.entries(dictionary.items || {})) {
    if (alreadyMatchedIds.has(itemId)) continue
    const score = similarity(normalized, def.displayName)
    if (!best || score > best.score) best = { itemId, name: def.displayName, score }
  }
  for (const [keyword, itemId] of Object.entries(dictionary.synonyms || {})) {
    if (alreadyMatchedIds.has(itemId) || !dictionary.items?.[itemId]) continue
    const score = similarity(normalized, keyword)
    if (!best || score > best.score) {
      best = { itemId, name: dictionary.items[itemId].displayName, score }
    }
  }
  if (best && best.score >= 0.62) {
    return { kind: 'missing_keyword', normalized, suggestedItemId: best.itemId,
      suggestedIconName: best.name, confidence: best.score }
  }
  return { kind: 'missing_icon', normalized, suggestedItemId: null,
    suggestedIconName: concept.trim().slice(0, 80), confidence: best?.score || 0 }
}

export async function recordItemLearningConcepts(supabase, concepts, dictionary, matchedItems) {
  const matched = new Set((matchedItems || []).map((item) => item.itemId))
  for (const raw of (Array.isArray(concepts) ? concepts : []).slice(0, 3)) {
    if (typeof raw !== 'string') continue
    const concept = raw.trim().slice(0, 80)
    const candidate = classifyConcept(concept, dictionary, matched)
    if (!candidate) continue
    let query = supabase.from('item_learning_candidates').select('id, occurrence_count')
      .eq('kind', candidate.kind).eq('normalized_concept', candidate.normalized)
    query = candidate.suggestedItemId
      ? query.eq('suggested_item_id', candidate.suggestedItemId)
      : query.is('suggested_item_id', null)
    const { data: existing } = await query.maybeSingle()
    if (existing) {
      await supabase.from('item_learning_candidates').update({
        occurrence_count: existing.occurrence_count + 1,
        last_seen_at: new Date().toISOString(), confidence: candidate.confidence,
      }).eq('id', existing.id)
    } else {
      const { error } = await supabase.from('item_learning_candidates').insert({
        kind: candidate.kind, concept, normalized_concept: candidate.normalized,
        suggested_item_id: candidate.suggestedItemId,
        suggested_icon_name: candidate.suggestedIconName, confidence: candidate.confidence,
      })
      if (error?.code !== '23505' && error) console.warn('[item-learning] insert failed:', error.message)
    }
  }
}
