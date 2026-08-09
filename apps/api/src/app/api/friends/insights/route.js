import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { generateBrief } from '@/lib/connection-brief'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'edge'


/**
 * GET /api/friends/insights?userId=...&date=YYYY-MM-DD
 *
 * Connection Dashboard 板块4 (Plus 专属): daily AI guidance about the paired
 * partner — Emotion / Topic / Care Tips / Boundaries / Hangout Ideas.
 * One AI run per pair member per day, cached in connection_insights.
 *
 * Privacy: reads ONLY what the partner already shows this user — reflects
 * with the visibility toggle on; bodies only when the partner's global
 * details opt-in is on, otherwise item names alone.
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const reqDate = searchParams.get('date') || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reqDate)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    // SECURITY (2026-08-07 audit): the daily cache is keyed on `date`; a client
    // iterating past dates forced a fresh AI call each time. Clamp to
    // today/yesterday so the once-per-day cache can't be walked.
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const date = reqDate === today || reqDate === yesterday ? reqDate : today

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Plus gate (server-side; the client badge is cosmetic).
    const { data: me } = await supabase
      .from('profiles').select('subscription_tier, ai_consent_at').eq('id', userId).maybeSingle()
    if ((me?.subscription_tier ?? 'free') === 'free') {
      return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    }
    if (!me?.ai_consent_at) {
      return NextResponse.json({ error: 'consent_required' }, { status: 403 })
    }

    const { data: pairing } = await supabase
      .from('pairings')
      .select('partner_user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (!pairing) return NextResponse.json({ success: true, paired: false, insights: null })
    const partnerId = pairing.partner_user_id
    const [ua, ub] = userId < partnerId ? [userId, partnerId] : [partnerId, userId]

    // Daily cache first. Update cadence (2026-08-09 spec): the Writer's FIRST
    // shared entry of the day triggers one refresh; later same-day entries
    // wait for tomorrow's consolidated run (LOOKBACK covers them). Hard cap:
    // 2 generations per pair member per day.
    const { data: cached } = await supabase
      .from('connection_insights')
      .select('payload, created_at')
      .eq('user_a', ua).eq('user_b', ub).eq('for_date', date).eq('for_user', userId)
      .maybeSingle()
    if (cached) {
      const { data: firstToday } = await supabase
        .from('reflects')
        .select('created_at')
        .eq('user_id', partnerId)
        .eq('shared_to_friends', true)
        .eq('local_date', date)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      const staleAgainstFirstEntry =
        firstToday && new Date(firstToday.created_at) > new Date(cached.created_at)
      if (!staleAgainstFirstEntry) {
        return NextResponse.json({ success: true, paired: true, insights: cached.payload, cached: true })
      }
      // fall through to regenerate (run 2) — the daily cap below still applies
    }

    // Generation cap: 2 runs per pair member per local day.
    const genGate = await rateLimit(supabase, `insights-gen:${ua}:${ub}:${userId}`, 2, 86400)
    if (!genGate.allowed) {
      return NextResponse.json({
        success: true, paired: true,
        insights: cached ? cached.payload : null,
        cached: true,
      })
    }

    const result = await generateBrief(supabase, {
      ua, ub, forUser: userId, partnerId, date,
      cachedPayload: cached ? cached.payload : null,
    })
    if (!result.ok) {
      if (result.reason === 'no_input') {
        return NextResponse.json({ success: true, paired: true, insights: null, reason: 'no_input' })
      }
      return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
    }
    return NextResponse.json({ success: true, paired: true, insights: result.insights, cached: false })
  } catch (err) {
    console.error('[friends/insights] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
