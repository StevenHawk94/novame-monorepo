import { cleanConnectionUpdates } from './reflect-ai'

const MODULES = [
  'worth_knowing', 'recent_vibe', 'what_theyre_into', 'how_to_show_up',
  'talk_about', 'try_together', 'shared_rhythm',
]

const SIGNAL_TYPE_BY_SECTION = {
  missed: 'concrete_development',
  world: 'ongoing_pattern',
  ways_in: 'support_opening',
  between: 'shared_pattern',
}

const CARD_SIGNAL_TYPE_BY_SECTION = {
  missed: 'event', world: 'trend', ways_in: 'action', between: 'shared_pattern',
}

const SENSITIVE_EMOTIONS = new Set([
  'anxious_uncertain', 'angry_frustrated', 'lonely_disconnected',
  'sad_grieving', 'depleted_overloaded',
])

const SEMANTIC_STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'been', 'being', 'but',
  'current', 'currently', 'for', 'from', 'have', 'into', 'more', 'one',
  'person', 'that', 'the', 'their', 'them', 'they', 'this', 'with', 'without',
])

function canonical(value, max = 100) {
  if (typeof value !== 'string') return null
  const clean = value.trim().slice(0, max).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return clean || null
}

function emptyUpdates() {
  return Object.fromEntries(MODULES.map((key) => [key, {
    hasUpdate: false, clearExisting: false, cards: [],
  }]))
}

function defaultModule(signal) {
  if (signal.assignedSection === 'missed') return 'worth_knowing'
  if (signal.assignedSection === 'between') return 'shared_rhythm'
  if (signal.assignedSection === 'world') {
    return ['preference', 'invitation'].includes(signal.kind)
      ? 'what_theyre_into' : 'recent_vibe'
  }
  if (['listen', 'conversation', 'talk'].includes(signal.supportMode)) return 'talk_about'
  if (['company', 'companionship', 'share', 'join_in', 'invite_join'].includes(signal.supportMode)) {
    return 'try_together'
  }
  return 'how_to_show_up'
}

function defaultLabelKey(signal) {
  if (signal.assignedSection === 'missed') {
    return ['upcoming', 'invitation'].includes(signal.kind) ? 'coming_up' : 'change'
  }
  if (signal.assignedSection === 'world') {
    if (signal.kind === 'state') return 'mood'
    if (signal.kind === 'preference') return 'interest'
    if (signal.kind === 'pattern') return 'pattern'
    return 'priority'
  }
  if (signal.assignedSection === 'between') return 'shared_rhythm'
  if (signal.supportMode === 'give_space') return 'give_space'
  if (['encourage', 'celebrate'].includes(signal.supportMode)) return 'encourage'
  if (['practical_help'].includes(signal.supportMode)) return 'practical_help'
  if (['company', 'companionship', 'light_distraction', 'invite_join'].includes(signal.supportMode)) {
    return 'companionship'
  }
  if (['reassure', 'reassure_presence', 'validate'].includes(signal.supportMode)) return 'comfort'
  if (['conversation'].includes(signal.supportMode)) return 'talk'
  return 'listen'
}

function words(value) {
  return (String(value || '').toLowerCase().match(/[a-z0-9']+/g) || [])
    .filter((word) => word.length >= 2 && !SEMANTIC_STOPWORDS.has(word))
}

function normalizedPhrase(value) {
  return words(value).join(' ')
}

function similarity(query, candidate) {
  const q = words(query)
  const c = words(candidate)
  if (q.length === 0 || c.length === 0) return 0
  const qPhrase = q.join(' ')
  const cPhrase = c.join(' ')
  if (qPhrase === cPhrase || (Math.min(qPhrase.length, cPhrase.length) >= 8
    && (qPhrase.includes(cPhrase) || cPhrase.includes(qPhrase)))) return 1
  const qSet = new Set(q)
  const cSet = new Set(c)
  let overlap = 0
  for (const word of qSet) if (cSet.has(word)) overlap += 1
  if (overlap === 0) return 0
  const precision = overlap / qSet.size
  const recall = overlap / cSet.size
  return (2 * precision * recall) / (precision + recall)
}

function semanticScore(signal, scenario) {
  const cue = [signal.semanticCue, signal.summary, signal.topicKey].filter(Boolean).join(' ')
  const aliases = String(scenario.searchAliases || '').split('|').map((value) => value.trim())
  const candidates = [
    scenario.scenarioKey?.replace(/_/g, ' '), scenario.scenario,
    scenario.retrievalText, ...aliases,
  ].filter(Boolean)
  const best = candidates.reduce((score, value) => Math.max(score, similarity(cue, value)), 0)
  return Math.round(best * 25 * 100) / 100
}

function same(left, right) {
  const a = canonical(left)
  const b = canonical(right)
  return !!a && !!b && a === b
}

function scoreScenario(signal, scenario) {
  let score = 50 // exact family + exact section-derived signal type
  if (same(signal.supportMode, scenario.supportMode)) score += 20
  if (same(signal.boundary, scenario.boundary)) score += 15
  if (same(signal.responsePreference, scenario.responsePreference)) score += 10
  if (same(signal.temporalState, scenario.temporalState)) score += 10
  if (same(signal.topicDomain, scenario.topicDomain)) score += 8
  if (same(signal.emotionFamily, scenario.emotionFamily)) score += 5
  if (same(signal.emotionalWeight, scenario.emotionalWeight)) score += 3
  score += semanticScore(signal, scenario)
  return Math.round(score * 100) / 100
}

function disqualifierMatched(signal, scenario) {
  const cue = [signal.semanticCue, signal.summary, signal.topicKey].filter(Boolean).join(' ')
  if (!cue || !scenario.disqualifiers) return false
  return String(scenario.disqualifiers).split(';').some((clause) => (
    clause.trim().length >= 8 && similarity(cue, clause) >= 0.78
  ))
}

function eligibleScenario(signal, scenario) {
  if (!same(signal.familyKey || signal.scenarioFamily, scenario.familyKey)) return false
  if (!same(signal.assignedSection, scenario.section)) return false
  if (!same(SIGNAL_TYPE_BY_SECTION[signal.assignedSection], scenario.signalType)) return false
  const evidenceStrength = canonical(signal.evidenceStrength)
  // Durable jobs created before v6 have confidence but no evidenceStrength.
  // Keep those retryable without paying for fallback copy solely because the
  // schema evolved; all new router output still uses the stricter enum.
  if (evidenceStrength) {
    if (!['strong', 'moderate'].includes(evidenceStrength)) return false
  } else if (!Number.isFinite(signal.confidence) || signal.confidence < 0.55) {
    return false
  }
  // The spreadsheet's structured dimensions are the build-time compiled
  // form of Required Evidence. Natural-language rules never incur another AI
  // call at runtime; unsupported or disqualified candidates are removed here.
  if (semanticScore(signal, scenario) === 0 || disqualifierMatched(signal, scenario)) return false
  if (signal.assignedSection === 'world') {
    if (signal.persistence !== 'repeated_or_explicit_continuity') return false
    if (signal.temporalState !== 'ongoing_repeated') return false
  }
  if (signal.assignedSection === 'ways_in') {
    if (!signal.supportMode || signal.supportMode === 'none') return false
    if (['unclear', 'not_applicable'].includes(signal.supportOpenness)) return false
    if (!signal.responsePreference || signal.responsePreference === 'not_applicable') return false
    if (['unknown', 'privacy'].includes(signal.boundary)) return false
  }
  if (signal.assignedSection === 'between') {
    if (signal.mutuality !== 'two_sided_independent') return false
    if (signal.persistence !== 'independent_pair_evidence') return false
  }
  return true
}

export function selectConnectionScenario(signal, scenarios, {
  minimumScore = 70, minimumMargin = 12,
} = {}) {
  const ranked = (scenarios || [])
    .filter((scenario) => eligibleScenario(signal, scenario))
    .map((scenario) => ({ scenario, score: scoreScenario(signal, scenario) }))
    .sort((left, right) => right.score - left.score
      || String(left.scenario.scenarioKey).localeCompare(String(right.scenario.scenarioKey)))
  const top = ranked[0]
  const runnerUp = ranked[1]
  if (!top || top.score < minimumScore) {
    return { matched: false, reason: 'below_match_threshold', ranked: ranked.slice(0, 3) }
  }
  const margin = runnerUp ? top.score - runnerUp.score : top.score
  if (runnerUp && margin < minimumMargin) {
    return { matched: false, reason: 'ambiguous_scenario_match', ranked: ranked.slice(0, 3) }
  }
  return {
    matched: true, scenario: top.scenario, score: top.score,
    margin: Math.round(margin * 100) / 100, ranked: ranked.slice(0, 3),
  }
}

function safeSlot(value) {
  if (typeof value !== 'string') return null
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, 96)
  if (!clean || clean.split(/\s+/).length > 12) return null
  if (/https?:\/\/|www\.|@|\b\d{5,}\b/i.test(clean)) return null
  return clean
}

function renderText(value, slots) {
  if (value == null) return null
  let rendered = String(value)
  const required = [...rendered.matchAll(/{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g)]
  for (const [, key] of required) {
    const replacement = safeSlot(slots?.[key])
    if (!replacement) return null
    rendered = rendered.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), replacement)
  }
  return rendered.trim() || null
}

function requestedDepthBand(signal, scenario) {
  const levels = String(scenario.depthRange || '').match(/L[2-5]/g) || []
  const recommendation = String(signal.depthRecommendation || '').toUpperCase()
  const hasSecondAnchor = Number(signal.evidenceCount || 1) >= 2
    && !!safeSlot(signal.slotValues?.anchorPhrase)
  const hasRequiredContext = !['world', 'between'].includes(signal.assignedSection)
    || !!safeSlot(signal.slotValues?.contextCue)
  return levels.length > 1 && recommendation === levels[levels.length - 1]
    && signal.evidenceStrength === 'strong' && hasSecondAnchor && hasRequiredContext
    ? 'upper' : 'lower'
}

function requestedTone(signal) {
  const playful = signal.toneMode === 'playful_close'
    && ['explicit_playful_style', 'light_low_stakes'].includes(signal.toneEvidence)
    && signal.emotionalWeight !== 'sensitive'
    && !SENSITIVE_EMOTIONS.has(signal.emotionFamily)
  return playful ? 'playful_close' : 'warm_clear'
}

function templateForSignal(signal, scenario, variants) {
  const matching = (variants || []).filter((variant) => same(variant.scenarioKey, scenario.scenarioKey))
  const preferredDepth = requestedDepthBand(signal, scenario)
  const preferredTone = requestedTone(signal)
  const order = [
    [preferredDepth, preferredTone],
    [preferredDepth, 'warm_clear'],
    ['lower', preferredTone],
    ['lower', 'warm_clear'],
  ]
  const seen = new Set()
  for (const [depth, tone] of order) {
    const key = `${depth}:${tone}`
    if (seen.has(key)) continue
    seen.add(key)
    const variant = matching.find((row) => row.depthBand === depth && row.toneMode === tone
      && (tone !== 'playful_close' || row.playfulEligible === true))
    if (!variant) continue
    const card = {
      label: renderText(variant.templateCard?.label, signal.slotValues),
      title: renderText(variant.templateCard?.title, signal.slotValues),
      observation: renderText(variant.templateCard?.observation, signal.slotValues),
      meaning: renderText(variant.templateCard?.meaning, signal.slotValues),
      takeaway: renderText(variant.templateCard?.takeaway, signal.slotValues),
    }
    if (card.label && card.observation) return { variant, card }
  }
  return null
}

export function matchConnectionTemplates({
  selectedSignals, scenarioIndex, templateVariants, reflectId,
  currentConnectionBoard = null, allowSharedRhythm = false,
}) {
  const rawUpdates = emptyUpdates()
  const signalResults = []
  const unmatchedSignals = []
  const matches = []
  for (const signal of selectedSignals || []) {
    const selected = selectConnectionScenario(signal, scenarioIndex)
    if (!selected.matched) {
      unmatchedSignals.push(signal)
      matches.push({ signalId: signal.signalId, matched: false, reason: selected.reason, ranked: selected.ranked })
      continue
    }
    const rendered = templateForSignal(signal, selected.scenario, templateVariants)
    if (!rendered) {
      unmatchedSignals.push(signal)
      matches.push({ signalId: signal.signalId, matched: false, reason: 'template_variant_unrenderable' })
      continue
    }
    const moduleKey = defaultModule(signal)
    rawUpdates[moduleKey].hasUpdate = true
    rawUpdates[moduleKey].cards.push({
      ...rendered.card,
      reviewedTemplate: true,
      signalId: signal.signalId,
      topicKey: signal.topicKey,
      signalType: CARD_SIGNAL_TYPE_BY_SECTION[signal.assignedSection],
      assignedSection: signal.assignedSection,
      labelKey: defaultLabelKey(signal),
      confidence: signal.confidence,
      whyThis: `template:${selected.scenario.scenarioKey}:${rendered.variant.variantKey}`,
      expiresAt: signal.expiresAt || null,
    })
    signalResults.push({
      signalId: signal.signalId,
      outcome: 'matched',
      familyKey: selected.scenario.familyKey,
      scenarioKey: selected.scenario.scenarioKey,
      templateVariantId: rendered.variant.templateVariantId,
      moduleKey,
      reason: 'deterministic_template_match',
      matchScore: selected.score,
      matchMargin: selected.margin,
    })
    matches.push({
      signalId: signal.signalId, matched: true,
      scenarioKey: selected.scenario.scenarioKey,
      templateVariantId: rendered.variant.templateVariantId,
      score: selected.score, margin: selected.margin,
    })
  }
  return {
    signalResults,
    unmatchedSignals,
    matches,
    updates: cleanConnectionUpdates(rawUpdates, reflectId, {
      allowSharedRhythm, maxTotal: 3, currentBoard: currentConnectionBoard,
    }),
  }
}

export function connectionTemplateInternals() {
  return { emptyUpdates, defaultModule, defaultLabelKey }
}
