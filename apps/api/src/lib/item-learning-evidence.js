import { ITEM_DICTIONARY, NEVER_AUTO_ITEMS, normalizeItemKeyword, matchItems } from '@novame/engine'

const includesPhrase = (text, phrase) => (` ${normalizeItemKeyword(text)} `).includes(` ${normalizeItemKeyword(phrase)} `)
function hasAffirmativeOccurrence(journal, phrase) {
  const words = normalizeItemKeyword(journal).split(' '), target = normalizeItemKeyword(phrase).split(' ')
  return words.some((_, at) => target.every((word, i) => words[at + i] === word)
    && !words.slice(Math.max(0, at - 3), at).some(word => /^(not|no|never|without|skipped|avoided|didn't|didnt|couldn't|couldnt)$/.test(word)))
}
export function itemLearningHints(journal) {
  return Object.entries(NEVER_AUTO_ITEMS).filter(([word]) => includesPhrase(journal, word)).slice(0, 12)
    .map(([word, ids]) => ({ word, possibleMeanings: ids.slice(0, 3).map(id => ITEM_DICTIONARY.items[id]?.displayName).filter(Boolean) }))
}

/** Only literal, short, privacy-safe source spans may enter the admin queue. */
export function cleanLearningSignals(values, journal, dictionary = ITEM_DICTIONARY) {
  const seen = new Set()
  return (Array.isArray(values) ? values : []).slice(0, 6).flatMap(value => {
    const phrase = typeof value?.phrase === 'string' ? value.phrase.trim().replace(/\s+/g, ' ') : ''
    const concept = typeof value?.concept === 'string' ? value.concept.trim() : ''
    const key = normalizeItemKeyword(phrase)
    if (value?.literal !== true || value?.privacySafe !== true || !phrase || phrase.length > 80
      || !concept || concept.length > 60 || key.split(' ').length > 12 || !includesPhrase(journal, phrase) || !hasAffirmativeOccurrence(journal, phrase)
      || seen.has(key) || /[\d@:/]/.test(phrase)
      || /\b(i|you|he|she|we|they|my|your|his|her|our|their|diagnosis|salary|address|account|password|not|never|without)\b/i.test(phrase)) return []
    // Test executable rules, not raw synonyms: exclusions can also explain a gap.
    const hits = matchItems(phrase, dictionary)
    if (hits.some(hit => normalizeItemKeyword(hit.displayName) === normalizeItemKeyword(concept))) return []
    seen.add(key)
    return [{ phrase, concept }]
  })
}

/** Lexical search retrieves candidates only. It never decides semantic equivalence. */
const indexes = new WeakMap()
export function learningShortlist(concept, dictionary) {
  const key = normalizeItemKeyword(concept)
  const words = key.split(' ').filter(word => word.length > 2)
  const exact = dictionary.synonyms[key]
  let index = indexes.get(dictionary)
  if (!index) {
    index = Object.entries(dictionary.items).map(([id, item]) => ({
      id, item, name: normalizeItemKeyword(item.displayName),
      terms: new Set((item.keywords || []).map(normalizeItemKeyword)),
      visual: new Set(normalizeItemKeyword(item.visualConcept || '').split(' ')),
    }))
    indexes.set(dictionary, index)
  }
  return index.map(({id, item, name, terms, visual}) => {
    const score = name === key ? 100 : id === exact ? 95 : terms.has(key) ? 90
      : words.reduce((n, word) => n + (name.split(' ').includes(word) ? 10 : visual.has(word) ? 2 : 0), 0)
    return { id, name: item.displayName, category: item.category, visual: item.visualConcept?.slice(0, 100), score }
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8)
    .map(({ score, ...item }) => item)
}
