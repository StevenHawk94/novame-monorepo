import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const DIMENSIONS = [
  { key: 'mood', label: 'Mood' },
  { key: 'energy', label: 'Energy' },
  { key: 'stress', label: 'Stress' },
  { key: 'openness', label: 'Openness' },
  { key: 'connection', label: 'Connection' },
  { key: 'enjoyment', label: 'Enjoyment' },
]

const RX = {
  moodUp: /\b(happy|good|great|joyful|excited|content|cheerful|hopeful|calm)\b/i,
  moodDown: /\b(sad|bad|terrible|upset|angry|miserable|down|heartbroken|frustrated)\b/i,
  energyUp: /\b(energetic|energized|rested|refreshed|full of energy|recharged)\b/i,
  energyDown: /\b(tired|sleepy|exhausted|drained|worn out|no energy|fatigued)\b/i,
  stressUp: /\b(stressed|stressful|overwhelmed|anxious|anxiety|deadline|under pressure|too much|swamped)\b/i,
  stressDown: /\b(relaxed|relaxing|at ease|peaceful|unbothered|low stress)\b/i,
  feeling: /\b(feel|feeling|felt|i'm|i am|need|wish|want|because|since|made me)\b/i,
  reason: /\b(because|since|after|when|about|need|wish|want|hoping|worried that)\b/i,
  connected: /\b(together|friend|family|partner|mom|mother|dad|father|sister|brother|called|call with|met|visited|hangout|hung out|date night|shared)\b/i,
  disconnected: /\b(lonely|alone|isolated|miss them|missing someone|disconnected|left out)\b/i,
  enjoyUp: /\b(enjoyed|enjoying|loved|love this|fun|delightful|favorite|relaxed|great time|had a blast)\b/i,
  enjoyDown: /\b(boring|bored|hated|hate this|no fun|didn't enjoy|did not enjoy|lost interest)\b/i,
}

const TOPICS = [
  ['Work', /\b(work|office|meeting|deadline|project|boss|client|shift|coworker|colleague)\b/i],
  ['Family', /\b(family|mom|mother|dad|father|parent|sister|brother|child|kids)\b/i],
  ['Friends', /\b(friend|friends|hangout|hung out)\b/i],
  ['Sleep', /\b(sleep|slept|bed|nap|rested|insomnia)\b/i],
  ['Cooking', /\b(cook|cooking|bake|baking|recipe|kitchen)\b/i],
  ['Exercise', /\b(walk|walking|run|running|gym|workout|exercise|yoga|hike)\b/i],
  ['Entertainment', /\b(movie|film|show|music|song|game|concert|book|reading)\b/i],
  ['Food', /\b(breakfast|lunch|dinner|coffee|tea|restaurant|meal|food)\b/i],
  ['Travel', /\b(travel|trip|flight|vacation|hotel|airport)\b/i],
]

// These records are excluded before counting. If they are the only records,
// the response is the same generic no-data state, so their existence is never
// revealed to the reader.
const SENSITIVE = /\b(suicid|self[- ]?harm|diagnos|medication|abuse|assault|argument|fight with|family conflict)\b/i

function signal(key, text, hasSharedInteraction) {
  if (key === 'mood') {
    if (RX.moodUp.test(text)) return { score: 4.2, confidence: 0.8 }
    if (RX.moodDown.test(text)) return { score: 1.8, confidence: 0.8 }
    if (/\bfine\b/i.test(text)) return { score: 3, confidence: 0.72 }
  }
  if (key === 'energy') {
    if (RX.energyUp.test(text)) return { score: 4.4, confidence: 0.84 }
    if (RX.energyDown.test(text)) return { score: 1.6, confidence: 0.86 }
  }
  if (key === 'stress') {
    if (RX.stressUp.test(text)) return { score: 4.3, confidence: 0.85 }
    if (RX.stressDown.test(text)) return { score: 1.7, confidence: 0.8 }
  }
  if (key === 'openness' && RX.feeling.test(text) && RX.reason.test(text)) {
    const namesNeed = /\b(need|wish|want)\b/i.test(text)
    const givesCause = /\b(because|since|made me|worried that)\b/i.test(text)
    return { score: namesNeed && givesCause ? 4.5 : 3.7, confidence: 0.7 }
  }
  if (key === 'connection') {
    if (RX.disconnected.test(text)) return { score: 1.8, confidence: 0.82 }
    if (RX.connected.test(text) || hasSharedInteraction) return { score: 4, confidence: hasSharedInteraction ? 0.72 : 0.76 }
  }
  if (key === 'enjoyment') {
    if (RX.enjoyUp.test(text)) return { score: 4.3, confidence: 0.83 }
    if (RX.enjoyDown.test(text)) return { score: 1.7, confidence: 0.82 }
  }
  return null
}

function weightFor(ageDays, days) {
  if (days <= 30) {
    if (ageDays <= 3) return 1
    if (ageDays <= 7) return 0.8
    if (ageDays <= 14) return 0.5
    return 0.25
  }
  const ratio = ageDays / days
  if (ratio <= 0.1) return 1
  if (ratio <= 0.24) return 0.8
  if (ratio <= 0.48) return 0.5
  return 0.25
}

function mean(rows, days, now) {
  let weighted = 0
  let total = 0
  for (const row of rows) {
    const age = Math.max(0, (now - new Date(row.occurredAt).getTime()) / 86400000)
    const weight = weightFor(age, days)
    weighted += row.score * weight
    total += weight
  }
  return total ? weighted / total : null
}

function enough(rows, key) {
  const minRows = key === 'openness' ? 4 : 3
  const minDays = key === 'openness' ? 3 : 2
  const dates = new Set(rows.map((row) => row.date))
  const confidence = rows.length
    ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
    : 0
  return rows.length >= minRows && dates.size >= minDays && confidence >= 0.65
}

function trendFor(delta) {
  const size = Math.abs(delta)
  if (size < 0.25) return 'same'
  const direction = delta > 0 ? 'up' : 'down'
  if (size < 0.6) return `slight_${direction}`
  if (size < 1) return `noticeable_${direction}`
  return `much_${direction}`
}

function trendLabel(key, trend) {
  if (trend === 'same') return 'About the same'
  if (trend === 'current_only') return 'No comparison yet'
  if (trend === 'insufficient') return 'Building a baseline'
  if (trend === 'mixed') return 'Varied lately'
  const [amount, direction] = trend.split('_')
  const word = amount === 'slight' ? 'Slightly' : amount === 'noticeable' ? 'Noticeably' : 'Much'
  if (key === 'stress') return `${word} ${direction === 'up' ? 'higher' : 'lower'}`
  return `${word} ${direction === 'up' ? 'higher' : 'lower'}`
}

function systemCopy(label, trend, periodLabel) {
  if (trend === 'insufficient') return 'A clearer picture will appear as more moments are recorded.'
  if (trend === 'current_only') return `Here’s how their ${label.toLowerCase()} has been lately. A comparison will appear over time.`
  if (trend === 'same') return `Their ${label.toLowerCase()} has been about the same lately.`
  if (trend === 'mixed') return `Their ${label.toLowerCase()} has varied more than usual lately.`
  const [amount, direction] = trend.split('_')
  const amountWord = amount === 'slight' ? 'slightly' : amount === 'noticeable' ? 'noticeably' : 'much'
  return `Their ${label.toLowerCase()} has been ${amountWord} ${direction === 'up' ? 'higher' : 'lower'} ${amount === 'slight' ? periodLabel : 'lately'}.`
}

function topicsFor(rows, direction, currentMean) {
  const candidates = new Map()
  for (const row of rows) {
    for (const topic of row.topics) {
      if (!candidates.has(topic)) candidates.set(topic, [])
      candidates.get(topic).push(row)
    }
  }
  return [...candidates.entries()]
    .filter(([, topicRows]) => new Set(topicRows.map((r) => r.date)).size >= 2 && topicRows.length >= 2)
    .filter(([, topicRows]) => {
      const average = topicRows.reduce((sum, row) => sum + row.score, 0) / topicRows.length
      return direction === 'up' ? average >= currentMean : direction === 'down' ? average <= currentMean : false
    })
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .map(([topic, topicRows]) => ({ topic, count: topicRows.length }))
}

function periodText(days) {
  return days === 7 ? 'this week' : days === 30 ? 'this month' : 'in the last 3 months'
}

function dateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

function completedPatternPeriods(now, anchorDate) {
  const anchorMs = new Date(`${anchorDate}T00:00:00Z`).getTime()
  const today = new Date(now)
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const completedCount = Math.max(0, Math.floor((todayMs - anchorMs) / (7 * 86400000)))
  const periods = []
  // Oldest first, every completed seven-day period. Anchoring to the
  // first shared reflection makes the ranges continuous for this relationship
  // (for example Jul 4-10, Jul 11-17) instead of arbitrary calendar weeks.
  for (let index = 0; index < completedCount; index += 1) {
    const startMs = anchorMs + index * 7 * 86400000
    periods.push({
      startDate: dateOnly(startMs),
      endDate: dateOnly(startMs + 6 * 86400000),
    })
  }
  return periods
}

function scorePeriod(records, startDate, endDate) {
  const periodRows = records.filter((row) => row.date >= startDate && row.date <= endDate)
  if (periodRows.length === 0) return null
  const scores = {}
  for (const { key } of DIMENSIONS) {
    const values = periodRows
      .map((row) => signal(key, row.text, row.sharedInteraction))
      .filter(Boolean)
      .map((value) => value.score)
    scores[key] = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : null
  }
  return { startDate, endDate, evidenceCount: periodRows.length, scores }
}

export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const verified = await verifyToken(authHeader.replace(/^Bearer\s+/i, '').trim())
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Their Patterns is intentionally a seven-day product. Longer-term
    // context is exposed only as weekly score history, never as 30/90-day tabs.
    const days = 7

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const { data: pairing } = await supabase
      .from('pairings').select('partner_user_id, created_at').eq('user_id', userId).maybeSingle()
    if (!pairing) return NextResponse.json({ success: true, state: 'unpaired', days, dimensions: [] })

    const partnerId = pairing.partner_user_id
    // Their Patterns is an independent product surface. Memory-detail sharing
    // controls what the paired person can open/read in Memories, Connection,
    // and the Paired feed; it must not suppress pattern generation.
    const { data: profile } = await supabase.from('profiles')
      .select('display_name').eq('id', partnerId).maybeSingle()
    const firstReflectQuery = supabase.from('reflects').select('local_date').eq('user_id', partnerId)
    const { data: firstReflect } = await firstReflectQuery
      .order('local_date', { ascending: true }).limit(1).maybeSingle()

    const now = Date.now()
    // Full available relationship history for the calendar and score trend.
    const since = firstReflect?.local_date || pairing.created_at.slice(0, 10)
    const [a, b] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]
    const reflectsQuery = supabase.from('reflects')
      .select('id, body, local_date, created_at')
      .eq('user_id', partnerId)
    const [{ data: reflects }, { data: shared }] = await Promise.all([
      reflectsQuery.gte('local_date', since).order('created_at', { ascending: false }).limit(5000),
      supabase.from('shared_memory_items')
        .select('id, author_user_id, description, item_id, created_at')
        .eq('user_a', a).eq('user_b', b).eq('author_user_id', partnerId)
        .gte('created_at', `${since}T00:00:00Z`).order('created_at', { ascending: false }).limit(5000),
    ])
    const reflectIds = (reflects || []).map((row) => row.id)
    let memories = []
    if (reflectIds.length > 0) {
      const { data } = await supabase.from('item_memories')
        .select('reflect_id, item_id, raw_excerpt, refined_desc')
        .eq('user_id', partnerId)
        .gte('created_at', `${since}T00:00:00Z`)
        .order('created_at', { ascending: false })
        .limit(5000)
      const allowedReflectIds = new Set(reflectIds)
      memories = (data || []).filter((memory) => allowedReflectIds.has(memory.reflect_id))
    }
    const memoriesByReflect = new Map()
    for (const memory of memories) {
      if (!memoriesByReflect.has(memory.reflect_id)) memoriesByReflect.set(memory.reflect_id, [])
      memoriesByReflect.get(memory.reflect_id).push(memory)
    }

    const firstDate = firstReflect?.local_date ? new Date(`${firstReflect.local_date}T00:00:00Z`).getTime() : now
    const accountAgeDays = Math.max(0, Math.floor((now - firstDate) / 86400000))
    const recommendedDays = accountAgeDays < 30 ? 7 : 30
    const sharedByDate = new Set((shared || []).map((row) => row.created_at.slice(0, 10)))
    const records = (reflects || []).map((row) => {
      const text = row.body || ''
      const rowMemories = memoriesByReflect.get(row.id) || []
      const memory = rowMemories[0]
      const itemText = rowMemories.map((item) => item.item_id.replace(/[._]/g, ' ')).join(' ')
      return {
        id: row.id,
        text: `${text} ${itemText}`,
        excerpt: memory?.refined_desc || memory?.raw_excerpt || text,
        itemId: memory?.item_id || null,
        date: row.local_date,
        occurredAt: `${row.local_date}T12:00:00Z`,
        topics: TOPICS.filter(([, rx]) => rx.test(`${text} ${itemText}`)).map(([topic]) => topic),
        sharedInteraction: sharedByDate.has(row.local_date),
      }
    })
    for (const row of shared || []) {
      const date = row.created_at.slice(0, 10)
      if (!records.some((r) => r.date === date && r.sharedInteraction)) {
        records.push({
          id: `shared:${row.id}`,
          text: row.description || '',
          excerpt: row.description || '',
          itemId: row.item_id,
          date,
          occurredAt: row.created_at,
          topics: TOPICS.filter(([, rx]) => rx.test(`${row.description} ${row.item_id}`)).map(([topic]) => topic),
          sharedInteraction: true,
        })
      }
    }

    const safeRecords = records.filter((row) => !SENSITIVE.test(row.text))
    const boundary = now - days * 86400000
    const oldest = now - days * 2 * 86400000
    const dimensions = DIMENSIONS.map(({ key, label }) => {
      const allSignals = safeRecords.map((row) => {
        const found = signal(key, row.text, row.sharedInteraction)
        return found ? { ...row, ...found } : null
      }).filter(Boolean)
      const current = allSignals.filter((row) => new Date(row.occurredAt).getTime() >= boundary)
      const previous = allSignals.filter((row) => {
        const time = new Date(row.occurredAt).getTime()
        return time >= oldest && time < boundary
      })
      const currentReady = enough(current, key)
      const previousReady = enough(previous, key)
      const currentMean = currentReady ? mean(current, days, now) : null
      const previousMean = previousReady ? mean(previous, days, boundary) : null
      const mixed = currentReady &&
        current.filter((row) => row.score >= 3.5).length >= 2 &&
        current.filter((row) => row.score <= 2.5).length >= 2
      const trend = !currentReady
        ? 'insufficient'
        : mixed
          ? 'mixed'
        : !previousReady
          ? 'current_only'
          : trendFor(currentMean - previousMean)
      const direction = trend.endsWith('_up') ? 'up' : trend.endsWith('_down') ? 'down' : null
      const themes = direction ? topicsFor(current, direction, currentMean) : []
      const related = direction
        ? current
          .filter((row) => themes.length === 0 || row.topics.some((topic) => themes.some((t) => t.topic === topic)))
          .slice(0, 3)
          .map((row) => ({
            id: row.id,
            reflectId: row.id.startsWith('shared:') ? null : row.id,
            itemId: row.itemId,
            date: row.date,
            excerpt: row.excerpt.slice(0, 180),
          }))
        : []
      return {
        key, label, trend, trendLabel: trendLabel(key, trend),
        score: currentMean == null ? null : Math.round(currentMean * 10) / 10,
        summary: systemCopy(label, trend, periodText(days)),
        evidenceCount: current.length,
        dayCount: new Set(current.map((row) => row.date)).size,
        themes,
        related,
      }
    })

    const available = dimensions.filter((dimension) => dimension.trend !== 'insufficient')
    const changed = dimensions.filter((dimension) => /^(noticeable|much)_/.test(dimension.trend))
    const summary = changed.length > 0
      ? changed[0].summary
      : available.length > 0
        ? `Their recent patterns look mostly steady ${periodText(days)}.`
        : 'A clearer picture will appear as more moments are recorded.'
    const state = safeRecords.length === 0
      ? 'no_moments'
      : available.length > 0
        ? 'ready'
        : 'building_baseline'
    const historyAnchor = firstReflect?.local_date || safeRecords.map((row) => row.date).sort()[0] || dateOnly(now)
    const history = completedPatternPeriods(now, historyAnchor)
      .map((period) => scorePeriod(safeRecords, period.startDate, period.endDate))
      .filter(Boolean)
    const currentStart = dateOnly(now - 6 * 86400000)
    const currentEnd = dateOnly(now)
    const currentScores = scorePeriod(safeRecords, currentStart, currentEnd)

    return NextResponse.json({
      success: true, state, days, recommendedDays, partnerUserId: partnerId,
      partnerName: profile?.display_name || 'They', summary, dimensions,
      currentStart, currentEnd, history, currentScores,
    })
  } catch (err) {
    console.error('[friends/patterns] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
