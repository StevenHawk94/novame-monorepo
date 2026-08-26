import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

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
const copy = (value, max) => typeof value === 'string' && value.trim()
  ? value.trim().slice(0, max) : null

function publicCard(row) {
  if (!MODULE_KEYS.has(row?.module_key) || !row?.card || typeof row.card !== 'object') return null
  const body = copy(row.card.body, 500)
  if (!body) return null
  return {
    id: row.id,
    section: SECTION_BY_MODULE[row.module_key],
    moduleKey: row.module_key,
    label: copy(row.card.label, 60) || 'Worth Noticing',
    headline: copy(row.card.headline, 140),
    body,
    supportingText: copy(row.card.supportingText, 300),
    action: copy(row.card.action, 240),
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
    if ((searchParams.get('start') && !start) || (searchParams.get('end') && !end) || (start && end && start > end)) {
      return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 })
    }
    if (searchParams.get('since') && !since) {
      return NextResponse.json({ error: 'invalid_since' }, { status: 400 })
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
      return NextResponse.json({ success: true, paired: false, cards: [] })
    }

    const partnerId = pairing.partner_user_id
    const { data: partner, error: partnerError } = await supabase.from('profiles')
      .select('share_memory_details, memory_details_mode, ai_consent_at')
      .eq('id', partnerId).maybeSingle()
    if (partnerError) throw partnerError
    const mode = partner?.memory_details_mode
      || (partner?.share_memory_details === false ? 'none' : 'custom')
    if (mode === 'none' || !partner?.ai_consent_at) {
      return NextResponse.json({ success: true, paired: true, unavailable: true, cards: [] })
    }

    const [ua, ub] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]
    const rows = []
    const pageSize = 500
    for (let from = 0; from < 10000; from += pageSize) {
      let query = supabase.from('connection_card_history')
        .select('id, module_key, card_index, card, for_date, created_at')
        .eq('user_a', ua).eq('user_b', ub).eq('for_user', userId)
        .order('for_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('card_index', { ascending: true })
        .range(from, from + pageSize - 1)
      if (start) query = query.gte('for_date', start)
      if (end) query = query.lte('for_date', end)
      // Inclusive by design: multiple cards can share a timestamp. The client
      // merges by immutable history id, so no tied row can be skipped.
      if (since) query = query.gte('created_at', since)
      const { data, error } = await query
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < pageSize) break
    }

    return NextResponse.json({
      success: true,
      paired: true,
      cards: rows.map(publicCard).filter(Boolean),
    })
  } catch (error) {
    console.error('[friends/insights/history] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
