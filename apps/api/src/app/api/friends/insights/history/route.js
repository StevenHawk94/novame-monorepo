import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'
const PAGE_SIZE = 24

const MODULE_KEYS = new Set([
  'worth_knowing', 'recent_vibe', 'what_theyre_into', 'how_to_show_up',
  'talk_about', 'try_together', 'shared_rhythm',
])

const SECTION_BY_MODULE = {
  worth_knowing: 'missed',
  recent_vibe: 'world',
  what_theyre_into: 'world',
  how_to_show_up: 'ways_in',
  talk_about: 'ways_in',
  try_together: 'ways_in',
  shared_rhythm: 'between',
}

const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null
const isoTimestamp = (value) => {
  if (!value || typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}
const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')
  ? value : null
const copy = (value, max) => typeof value === 'string' && value.trim()
  ? value.trim().slice(0, max) : null
const label = (value) => (copy(value, 60) || 'Worth Noticing').split(/\s+/).slice(0, 3).join(' ')

function publicCard(row) {
  if (!MODULE_KEYS.has(row?.module_key) || !row?.card || typeof row.card !== 'object') return null
  const title = copy(row.card.title, 140) || copy(row.card.headline, 140)
  const observation = copy(row.card.observation, 500) || copy(row.card.body, 500)
  const meaning = copy(row.card.meaning, 300) || copy(row.card.supportingText, 300)
  const takeaway = copy(row.card.takeaway, 240) || copy(row.card.action, 240)
  if (!observation) return null
  return {
    id: row.id,
    section: SECTION_BY_MODULE[row.module_key],
    moduleKey: row.module_key,
    label: label(row.card.label),
    title: title || label(row.card.label),
    observation,
    meaning,
    takeaway,
    // Temporary response aliases keep already-released clients compatible.
    headline: title, body: observation, supportingText: meaning, action: takeaway,
    date: row.for_date,
    createdAt: row.created_at,
  }
}

export async function GET(request) {
  try {
    const verified = await verifyToken((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim())
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!verified || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const start = isoDate(searchParams.get('start'))
    const end = isoDate(searchParams.get('end'))
    const since = isoTimestamp(searchParams.get('since'))
    const beforeCreatedAt = isoTimestamp(searchParams.get('beforeCreatedAt'))
    const beforeId = uuid(searchParams.get('beforeId'))
    if ((searchParams.get('start') && !start) || (searchParams.get('end') && !end) || (start && end && start > end)) {
      return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 })
    }
    if (searchParams.get('since') && !since) {
      return NextResponse.json({ error: 'invalid_since' }, { status: 400 })
    }
    if ((searchParams.get('beforeCreatedAt') && !beforeCreatedAt)
      || (searchParams.get('beforeId') && !beforeId)) {
      return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const [{ data: viewer, error: viewerError }, { data: pairing, error: pairingError }] = await Promise.all([
      supabase.from('profiles').select('subscription_tier').eq('id', userId).maybeSingle(),
      supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle(),
    ])
    if (viewerError || pairingError) throw viewerError || pairingError
    if ((viewer?.subscription_tier || 'free') === 'free') {
      return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    }
    if (!pairing?.partner_user_id) {
      return NextResponse.json({ success: true, paired: false, cards: [], hasMore: false })
    }

    const partnerId = pairing.partner_user_id
    const { data: partner, error: partnerError } = await supabase.from('profiles')
      .select('share_memory_details, memory_details_mode, ai_consent_at')
      .eq('id', partnerId).maybeSingle()
    if (partnerError) throw partnerError
    const mode = partner?.memory_details_mode
      || (partner?.share_memory_details === false ? 'none' : 'custom')
    if (mode === 'none' || !partner?.ai_consent_at) {
      return NextResponse.json({ success: true, paired: true, unavailable: true, cards: [], hasMore: false })
    }

    const [ua, ub] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]
    let query = supabase.from('connection_card_history')
      .select('id, module_key, card_index, card, for_date, created_at')
      .eq('user_a', ua).eq('user_b', ub).eq('for_user', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)
    if (start) query = query.gte('for_date', start)
    if (end) query = query.lte('for_date', end)
    // Inclusive for realtime catch-up: immutable ids de-duplicate timestamp ties.
    if (since) query = query.gte('created_at', since)
    if (beforeCreatedAt && beforeId) {
      query = query.or(`created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`)
    } else if (beforeCreatedAt) {
      query = query.lt('created_at', beforeCreatedAt)
    }
    const { data, error } = await query
    if (error) throw error
    const rows = data || []
    const hasMore = rows.length > PAGE_SIZE
    const page = rows.slice(0, PAGE_SIZE)
    const last = page[page.length - 1]

    return NextResponse.json({
      success: true,
      paired: true,
      cards: page.map(publicCard).filter(Boolean),
      hasMore,
      nextBeforeCreatedAt: hasMore ? last?.created_at || null : null,
      nextBeforeId: hasMore ? last?.id || null : null,
    })
  } catch (error) {
    console.error('[friends/insights/history] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
