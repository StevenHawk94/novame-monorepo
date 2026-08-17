import { WEEKLY_DIMENSIONS } from './reflect-ai'

const DAY = 86400000
const LABELS = { mood: 'Mood', energy: 'Energy', stress: 'Stress', openness: 'Openness', connection: 'Connection', enjoyment: 'Enjoyment' }
const dateMs = (date) => Date.parse(`${date}T00:00:00Z`)
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

function scoresFor(rows) {
  const scores = {}
  for (const key of WEEKLY_DIMENSIONS) {
    const values = rows.map((row) => row.weekly_evidence?.[key]?.score).filter((n) => Number.isFinite(n))
    scores[key] = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null
  }
  return scores
}

function trend(current, previous) {
  if (current == null) return 'insufficient'
  if (previous == null) return 'current_only'
  const delta = current - previous
  if (Math.abs(delta) < .25) return 'same'
  return `${Math.abs(delta) < .6 ? 'slight' : Math.abs(delta) < 1 ? 'noticeable' : 'much'}_${delta > 0 ? 'up' : 'down'}`
}

export async function loadWeeklyContext(supabase, userId) {
  const { data: pairing } = await supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle()
  if (!pairing) return { state: 'unpaired', userId }
  const writerId = pairing.partner_user_id
  const [ua, ub] = userId < writerId ? [userId, writerId] : [writerId, userId]
  const [{ data: writer }, { data: analyses }, { data: generated }] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', writerId).maybeSingle(),
    supabase.from('reflect_ai_analyses').select('reflect_id, local_date, weekly_evidence, created_at')
      .eq('user_id', writerId).eq('status', 'completed').eq('weekly_eligible', true)
      .not('weekly_evidence', 'is', null).order('local_date', { ascending: true }).limit(5000),
    supabase.from('weekly_recaps').select('*').eq('user_a', ua).eq('user_b', ub).eq('for_user', userId)
      .order('period_start', { ascending: true }),
  ])
  const rows = analyses || []
  const periods = []
  if (rows.length) {
    const anchor = dateMs(rows[0].local_date)
    const completed = Math.max(0, Math.floor((Date.now() - anchor) / (7 * DAY)))
    for (let i = 0; i < completed; i += 1) {
      const startDate = iso(anchor + i * 7 * DAY); const endDate = iso(anchor + (i * 7 + 6) * DAY)
      const evidence = rows.filter((row) => row.local_date >= startDate && row.local_date <= endDate)
      if (evidence.length >= 2) periods.push({ startDate, endDate, evidence, evidenceCount: evidence.length, scores: scoresFor(evidence) })
    }
  }
  const generatedMap = new Map((generated || []).map((row) => [`${row.period_start}:${row.period_end}`, row]))
  const available = [...periods].reverse().find((p) => !generatedMap.has(`${p.startDate}:${p.endDate}`)) || null
  return { state: 'ready', userId, writerId, ua, ub, partnerName: writer?.display_name || 'They', periods, generated: generated || [], generatedMap, available }
}

export function weeklyResponse(context) {
  if (context.state === 'unpaired') return { success: true, state: 'unpaired', days: 7, dimensions: [], history: [] }
  const latest = context.generated.at(-1) || null
  const previous = context.generated.at(-2) || null
  const dimensions = WEEKLY_DIMENSIONS.map((key) => ({
    key, label: LABELS[key], trend: trend(latest?.scores?.[key], previous?.scores?.[key]),
    trendLabel: 'Compared with the previous recap', score: latest?.scores?.[key] ?? null,
    summary: latest?.payload?.dimensions?.[key]?.summary || 'A clearer picture will appear as more reflections are recorded.',
    evidenceCount: latest?.evidence_count || 0, dayCount: 0, themes: [], related: [],
  }))
  const history = context.generated.map((row) => ({
    startDate: row.period_start, endDate: row.period_end, evidenceCount: row.evidence_count, scores: row.scores,
  }))
  return {
    success: true, state: context.available ? 'ready_to_generate' : latest ? 'ready' : 'building_baseline', days: 7,
    partnerUserId: context.writerId, partnerName: context.partnerName,
    summary: latest?.payload?.summary || 'A clearer picture will appear as more reflections are recorded.',
    dimensions, currentStart: latest?.period_start, currentEnd: latest?.period_end,
    history, currentScores: history.at(-1) || null,
    newRecapAvailable: !!context.available,
    availablePeriod: context.available ? { startDate: context.available.startDate, endDate: context.available.endDate, evidenceCount: context.available.evidenceCount } : null,
  }
}
