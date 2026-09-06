const SIGNAL_KINDS = new Set([
  'event', 'state', 'pattern', 'preference', 'invitation', 'upcoming', 'support_need',
])
const CONTINUITY = new Set(['one_off', 'ongoing', 'repeated'])
const SENTIMENTS = new Set(['positive', 'neutral', 'negative', 'mixed'])
const SUPPORT_MODES = new Set([
  'comfort', 'encourage', 'listen', 'talk', 'companionship', 'practical_help',
  'give_space', 'share', 'join_in',
])

const DAY_MS = 24 * 60 * 60 * 1000
export const CONNECTION_ACTIVE_DAYS = 10
export const CONNECTION_RETENTION_DAYS = 30
export const CONNECTION_RECENT_SIGNAL_LIMIT = 12
export const CONNECTION_BACKGROUND_SIGNAL_LIMIT = 6

function text(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function canonical(value, max = 80) {
  const clean = text(value, max)
  if (!clean) return null
  return clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null
}

function confidence(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0
}

function futureIso(value, nowMs) {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > nowMs ? new Date(parsed).toISOString() : null
}

/**
 * Persist only compact, privacy-safe evidence. It is deliberately separate
 * from user-facing card copy so historical context stays small and neutral.
 */
export function cleanConnectionSignals(value, reflectId = null, nowMs = Date.now()) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== 'object') continue
    const signalId = canonical(raw.signalId)
    const topicKey = canonical(raw.topicKey)
    const kind = canonical(raw.kind, 40)
    const summary = text(raw.summary, 280)
    const conf = confidence(raw.confidence)
    if (!signalId || !topicKey || !SIGNAL_KINDS.has(kind) || !summary || conf < 0.55) continue
    const dedupeKey = `${topicKey}:${kind}:${canonical(raw.supportMode, 40) || ''}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const continuity = canonical(raw.continuity, 30)
    const sentiment = canonical(raw.sentiment, 30)
    const supportMode = canonical(raw.supportMode, 40)
    out.push({
      signalId,
      topicKey,
      kind,
      summary,
      continuity: CONTINUITY.has(continuity) ? continuity : 'one_off',
      sentiment: SENTIMENTS.has(sentiment) ? sentiment : 'neutral',
      supportMode: SUPPORT_MODES.has(supportMode) ? supportMode : null,
      confidence: conf,
      expiresAt: futureIso(raw.expiresAt, nowMs),
      evidenceIds: reflectId ? [reflectId] : [],
    })
    if (out.length >= 6) break
  }
  return out
}

function signalsFromLegacyUpdates(updates, reflectId, nowMs) {
  if (!updates || typeof updates !== 'object') return []
  const values = []
  for (const [moduleKey, module] of Object.entries(updates)) {
    for (const card of Array.isArray(module?.cards) ? module.cards : []) {
      const kind = moduleKey === 'worth_knowing' ? 'event'
        : ['recent_vibe', 'what_theyre_into'].includes(moduleKey) ? 'pattern'
          : ['how_to_show_up', 'talk_about', 'try_together'].includes(moduleKey) ? 'support_need'
            : 'pattern'
      values.push({
        signalId: card?.signalId || `${moduleKey}_${card?.topicKey || 'legacy'}`,
        topicKey: card?.topicKey || card?.signalId,
        kind,
        summary: card?.observation || card?.body,
        continuity: kind === 'pattern' ? 'ongoing' : 'one_off',
        sentiment: 'neutral',
        supportMode: kind === 'support_need' ? card?.labelKey : null,
        confidence: card?.confidence ?? 0.6,
        expiresAt: card?.expiresAt,
      })
    }
  }
  return cleanConnectionSignals(values, reflectId, nowMs)
}

function rowSignals(row, nowMs) {
  const retained = cleanConnectionSignals(row?.connection_signals, row?.reflect_id, nowMs)
  return retained.length > 0
    ? retained
    : signalsFromLegacyUpdates(row?.connection_updates, row?.reflect_id, nowMs)
}

export function hasConnectionEvidence(rows) {
  return Array.isArray(rows) && rows.some((row) => (
    (Array.isArray(row?.connection_signals) && row.connection_signals.length > 0)
    || (row?.connection_updates && typeof row.connection_updates === 'object')
  ))
}

function isBackgroundEligible(signal, occurrenceCount, nowMs) {
  if (signal.kind === 'upcoming' || signal.kind === 'invitation') {
    return !!signal.expiresAt && Date.parse(signal.expiresAt) > nowMs
  }
  if (signal.kind === 'pattern' || signal.kind === 'preference') {
    return signal.continuity !== 'one_off' || occurrenceCount > 1
  }
  if (signal.kind === 'state') return occurrenceCount > 1
  return false
}

function publicAggregate(entry, tier, nowMs) {
  const ageDays = Math.max(0, (nowMs - entry.lastSeenMs) / DAY_MS)
  return {
    topicKey: entry.topicKey,
    kind: entry.kind,
    summary: entry.summary,
    continuity: entry.occurrenceCount > 1 ? 'repeated' : entry.continuity,
    sentiment: entry.sentiment,
    supportMode: entry.supportMode,
    confidence: entry.confidence,
    occurrenceCount: entry.occurrenceCount,
    firstSeenAt: new Date(entry.firstSeenMs).toISOString(),
    lastSeenAt: new Date(entry.lastSeenMs).toISOString(),
    ageDays: Math.round(ageDays * 10) / 10,
    recencyTier: tier,
    expiresAt: entry.expiresAt,
  }
}

/**
 * Ten recent days remain the active context. Days 11-30 contribute only
 * persistent evidence and are collapsed by canonical topic/kind. This keeps
 * long histories from growing the prompt on every reflection.
 */
export function compactConnectionEvidence(rows, {
  nowMs = Date.now(),
  excludeReflectIds = [],
  recentLimit = CONNECTION_RECENT_SIGNAL_LIMIT,
  backgroundLimit = CONNECTION_BACKGROUND_SIGNAL_LIMIT,
  retainBackgroundOneOff = false,
} = {}) {
  const excluded = new Set(excludeReflectIds.filter(Boolean))
  const cutoffMs = nowMs - CONNECTION_RETENTION_DAYS * DAY_MS
  const activeCutoffMs = nowMs - CONNECTION_ACTIVE_DAYS * DAY_MS
  const aggregates = new Map()

  for (const row of Array.isArray(rows) ? rows : []) {
    if (excluded.has(row?.reflect_id)) continue
    const rowTime = Date.parse(row?.created_at || row?.completed_at || '')
    if (!Number.isFinite(rowTime) || rowTime < cutoffMs || rowTime > nowMs + DAY_MS) continue
    for (const signal of rowSignals(row, nowMs)) {
      const key = `${signal.topicKey}:${signal.kind}:${signal.supportMode || ''}`
      const prior = aggregates.get(key)
      if (!prior) {
        aggregates.set(key, {
          ...signal,
          firstSeenMs: rowTime,
          lastSeenMs: rowTime,
          occurrenceCount: 1,
        })
        continue
      }
      prior.firstSeenMs = Math.min(prior.firstSeenMs, rowTime)
      prior.lastSeenMs = Math.max(prior.lastSeenMs, rowTime)
      prior.occurrenceCount += 1
      prior.confidence = Math.max(prior.confidence, signal.confidence)
      if (rowTime >= prior.lastSeenMs) {
        prior.summary = signal.summary
        prior.sentiment = signal.sentiment
        prior.continuity = signal.continuity
        prior.expiresAt = signal.expiresAt || prior.expiresAt
      }
    }
  }

  const score = (entry) => {
    const ageDays = Math.max(0, (nowMs - entry.lastSeenMs) / DAY_MS)
    return entry.confidence * 2 + Math.min(1.5, Math.log2(entry.occurrenceCount + 1)) - ageDays * 0.04
  }
  const recent = []
  const background = []
  for (const entry of aggregates.values()) {
    if (entry.lastSeenMs >= activeCutoffMs) {
      // A one-off support need gets stale faster than descriptive evidence.
      if (entry.kind === 'support_need' && entry.occurrenceCount === 1
        && entry.lastSeenMs < nowMs - 7 * DAY_MS) continue
      recent.push(entry)
    } else if (retainBackgroundOneOff
      ? (!['upcoming', 'invitation'].includes(entry.kind)
        || (!!entry.expiresAt && Date.parse(entry.expiresAt) > nowMs))
      : isBackgroundEligible(entry, entry.occurrenceCount, nowMs)) {
      background.push(entry)
    }
  }
  recent.sort((a, b) => score(b) - score(a))
  background.sort((a, b) => score(b) - score(a))
  return [
    ...recent.slice(0, recentLimit).map((entry) => publicAggregate(entry, 'recent_10d', nowMs)),
    ...background.slice(0, backgroundLimit).map((entry) => publicAggregate(entry, 'background_11_30d', nowMs)),
  ]
}
