const SECTION_BY_MODULE = {
  worth_knowing: 'missed',
  recent_vibe: 'world',
  what_theyre_into: 'world',
  how_to_show_up: 'ways_in',
  talk_about: 'ways_in',
  try_together: 'ways_in',
  shared_rhythm: 'between',
}

const LABELS_BY_SECTION = {
  missed: {
    milestone: 'Milestone',
    change: 'Change',
    first: 'First',
    quiet_win: 'Quiet Win',
    coming_up: 'Coming Up',
  },
  world: {
    mood: 'Mood',
    routine: 'Routine',
    interest: 'Interest',
    priority: 'Priority',
    pattern: 'Pattern',
  },
  ways_in: {
    comfort: 'Comfort',
    encourage: 'Encourage',
    listen: 'Listen',
    talk: 'Talk',
    companionship: 'Companionship',
    practical_help: 'Practical Help',
    give_space: 'Give Space',
  },
  between: {
    shared_rhythm: 'Shared Rhythm',
    overlap: 'Overlap',
    contrast: 'Contrast',
    little_pattern: 'Little Pattern',
  },
}

const DEFAULT_LABEL_BY_MODULE = {
  worth_knowing: 'Worth Noticing',
  recent_vibe: 'Recent Vibe',
  what_theyre_into: 'Interest',
  how_to_show_up: 'Support',
  talk_about: 'Conversation',
  try_together: 'Together',
  shared_rhythm: 'Shared Rhythm',
}

const COPY_LIMITS = {
  title: 140,
  observation: 500,
  meaning: 300,
  takeaway: 240,
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'being', 'could', 'from',
  'have', 'into', 'just', 'more', 'might', 'really', 'some', 'that', 'their',
  'them', 'there', 'they', 'this', 'today', 'with', 'would',
])

const TOKEN_EQUIVALENTS = {
  completed: 'complete', completing: 'complete', finished: 'complete', finishing: 'complete', done: 'complete',
  played: 'play', playing: 'play', plays: 'play',
  enjoyed: 'enjoy', enjoying: 'enjoy', enjoys: 'enjoy',
  chatted: 'talk', chatting: 'talk', talked: 'talk', talking: 'talk',
  encouraged: 'encourage', encouraging: 'encourage',
  comforted: 'comfort', comforting: 'comfort',
  listened: 'listen', listening: 'listen',
  supported: 'support', supporting: 'support',
}

const CANNED_INFERENCE_OPENER = /^(?:it\s+(?:sounds|seems|appears|looks)\s+(?:like|as though)|they\s+(?:seem|appear)\b|this\s+(?:suggests|seems|appears)\b)/i

function copy(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function sentenceCase(value) {
  if (!value) return value
  const index = value.search(/[A-Za-z]/)
  if (index < 0) return value
  return value.slice(0, index) + value.charAt(index).toUpperCase() + value.slice(index + 1)
}

function normalizePairedPersonReference(value, max) {
  const clean = copy(value, max)
  if (!clean) return null
  return sentenceCase(clean
    .replace(/\bthe\s+writer(?:['’]s)\b/gi, 'their')
    .replace(/\b(to|for|with|about|from|around|beside|behind|without|toward|towards|of)\s+the\s+writer\b/gi, '$1 them')
    .replace(/\b(help|support|encourage|ask|tell|give|offer|remind|comfort|join|invite|message|text|call|leave|let|acknowledge)\s+the\s+writer\b/gi, '$1 them')
    .replace(/\bthe\s+writer\b/gi, 'they'))
}

/**
 * Mechanical confidence padding is a copy defect, not a reason to discard an
 * otherwise useful Connection card. The model is still asked to self-rewrite;
 * this is the deterministic safety net when one slips through.
 */
export function directifyConnectionCopy(value, max = COPY_LIMITS.observation) {
  const original = normalizePairedPersonReference(value, max)
  if (!original || !CANNED_INFERENCE_OPENER.test(original)) return original

  let repaired = original
    .replace(/^it\s+(?:sounds|seems|appears|looks)\s+(?:like|as though)\s+/i, '')
    .replace(/^this\s+(?:suggests|seems|appears)(?:\s+that)?\s+/i, '')
    .replace(/^they\s+(?:seem|appear)\s+to\s+be\s+/i, 'They are ')
    .replace(/^they\s+(?:seem|appear)\s+to\s+have\s+/i, 'They have ')
    .replace(/^they\s+(?:seem|appear)\s+to\s+/i, 'They ')
    .replace(/^they\s+(?:seem|appear)\s+/i, 'They are ')
    .trim()

  repaired = repaired.replace(/^[,;:\-–—]\s*/, '').trim()
  return copy(sentenceCase(repaired), max) || original
}

function canonicalKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') : ''
}

export function connectionLabelForKey(section, value) {
  const key = canonicalKey(value)
  const label = LABELS_BY_SECTION[section]?.[key]
  return label ? { key, label } : null
}

export function normalizeConnectionLabel(value, reference = null) {
  const label = copy(value, 36)
  if (!label) return null
  const words = label.split(/\s+/)
  if (words.length > 3) return null
  if (!/^[A-Za-z][A-Za-z'’&-]*(?:\s+[A-Za-z][A-Za-z'’&-]*){0,2}$/.test(label)) return null
  if (reference) {
    const referenceTerms = new Set(String(reference).toLowerCase().match(/[a-z0-9']+/g) || [])
    const labelTerms = label.toLowerCase().match(/[a-z0-9']+/g) || []
    // A label that simply lifts the event words is a summary, not a category.
    if (labelTerms.length > 0 && labelTerms.every((term) => referenceTerms.has(term))) return null
  }
  return label
}

function terms(value) {
  const matches = String(value || '').toLowerCase().match(/[a-z0-9']+/g) || []
  return new Set(matches.map((term) => TOKEN_EQUIVALENTS[term] || term)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term)))
}

function overlap(left, right) {
  const a = terms(left)
  const b = terms(right)
  if (a.size === 0 || b.size === 0) return { count: 0, ratio: 0 }
  let count = 0
  for (const term of a) if (b.has(term)) count += 1
  return { count, ratio: count / Math.min(a.size, b.size) }
}

function duplicates(left, right, threshold = 0.72) {
  if (!left || !right) return false
  const a = String(left).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  const b = String(right).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  if (!a || !b) return false
  if (a === b || (Math.min(a.length, b.length) >= 18 && (a.includes(b) || b.includes(a)))) return true
  const shared = overlap(left, right)
  return shared.count >= 2 && shared.ratio >= threshold
}

/**
 * Optional fields must add a separate job to the card. This guard also cleans
 * legacy generated cards at read time, without rewriting append-only History.
 */
export function pruneConnectionFields({ title, observation, meaning, takeaway }) {
  const body = directifyConnectionCopy(observation, COPY_LIMITS.observation)
  if (!body) return null

  let nextTitle = directifyConnectionCopy(title, COPY_LIMITS.title)
  let nextMeaning = directifyConnectionCopy(meaning, COPY_LIMITS.meaning)
  let nextTakeaway = directifyConnectionCopy(takeaway, COPY_LIMITS.takeaway)

  if (duplicates(nextTitle, body, 0.64)) nextTitle = null

  if (duplicates(nextMeaning, body, 0.68) || duplicates(nextMeaning, nextTitle, 0.72)) {
    nextMeaning = null
  } else if (/^(?:this|that|it)\s+(?:suggests?|may|might|could|seems?|looks?)/i.test(nextMeaning || '')) {
    // Legacy cards frequently wrapped the same fact in speculative boilerplate.
    // If that sentence still centers the same topic, it adds no reliable value.
    const shared = overlap(nextMeaning, body)
    if (shared.count >= 2) nextMeaning = null
  }

  if (duplicates(nextTakeaway, body, 0.82)
    || duplicates(nextTakeaway, nextTitle, 0.82)
    || duplicates(nextTakeaway, nextMeaning, 0.82)) {
    nextTakeaway = null
  }

  return {
    title: nextTitle,
    observation: body,
    meaning: nextMeaning,
    takeaway: nextTakeaway,
  }
}

export function connectionCardsDuplicate(left, right) {
  if (!left || !right) return false
  const leftTopic = canonicalKey(left.topicKey)
  const rightTopic = canonicalKey(right.topicKey)
  const leftSignal = canonicalKey(left.signalId)
  const rightSignal = canonicalKey(right.signalId)
  if ((leftTopic && leftTopic === rightTopic) || (leftSignal && leftSignal === rightSignal)) return true
  const leftCopy = [left.title, left.headline, left.observation, left.body, left.meaning,
    left.supportingText, left.takeaway, left.action].filter(Boolean).join(' ')
  const rightCopy = [right.title, right.headline, right.observation, right.body, right.meaning,
    right.supportingText, right.takeaway, right.action].filter(Boolean).join(' ')
  return duplicates(leftCopy, rightCopy, 0.72)
}

export function publicConnectionCard(card, moduleKey) {
  if (!card || typeof card !== 'object') return null
  const section = SECTION_BY_MODULE[moduleKey]
  if (!section) return null
  const labelResult = connectionLabelForKey(section, card.labelKey)
  const fields = pruneConnectionFields({
    title: copy(card.title, COPY_LIMITS.title) || copy(card.headline, COPY_LIMITS.title),
    observation: copy(card.observation, COPY_LIMITS.observation) || copy(card.body, COPY_LIMITS.observation),
    meaning: copy(card.meaning, COPY_LIMITS.meaning) || copy(card.supportingText, COPY_LIMITS.meaning),
    takeaway: copy(card.takeaway, COPY_LIMITS.takeaway) || copy(card.action, COPY_LIMITS.takeaway),
  })
  if (!fields) return null
  const label = normalizeConnectionLabel(card.label, [card.observation, card.body].filter(Boolean).join(' '))
    || labelResult?.label
    || DEFAULT_LABEL_BY_MODULE[moduleKey]
  return {
    ...(labelResult ? { labelKey: labelResult.key } : {}),
    label,
    ...fields,
    // Response aliases remain temporarily for already-released clients.
    headline: fields.title,
    body: fields.observation,
    supportingText: fields.meaning,
    action: fields.takeaway,
  }
}
