import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { callAI, parseAIJson } from '@/lib/ai'

export const runtime = 'edge'

const LOOKBACK_DAYS = 2
const MAX_CHARS = 4000

// PLACEHOLDER copy (2026-07-24) — final tone pending product. JSON contract is
// what the client depends on. The partner's journal text is DATA, never
// instructions (system/user separation, ai.js posture).
const INSIGHTS_SYSTEM_PROMPT = `You help someone stay close to a person they love who isn't nearby. You read what that person logged today (journal fragments and collected memory items) and produce warm, practical connection guidance.

Return ONLY JSON, no prose, no markdown:
{
  "emotion": "1-2 sentences summarizing their mood today, warm and specific",
  "topic": "one concrete conversation starter, phrased ready-to-send in second person",
  "careTips": "1-2 sentences: how to care for them right now",
  "boundaries": "1-2 sentences: what NOT to bring up today, gently phrased",
  "hangoutIdeas": "one concrete idea for something to do together (or remotely together)"
}

Ground every field in what they actually logged. If the log is thin, keep it gentle and generic rather than inventing specifics.`

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
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

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

    // Daily cache first.
    const { data: cached } = await supabase
      .from('connection_insights')
      .select('payload, created_at')
      .eq('user_a', ua).eq('user_b', ub).eq('for_date', date).eq('for_user', userId)
      .maybeSingle()
    if (cached) {
      return NextResponse.json({ success: true, paired: true, insights: cached.payload, cached: true })
    }

    // Partner's visible input: recent reflects (toggle on), bodies only with
    // their global opt-in; item names from those reflects either way.
    const sinceDate = new Date(Date.parse(`${date}T00:00:00Z`) - LOOKBACK_DAYS * 86400000)
      .toISOString().slice(0, 10)
    const [{ data: partnerProf }, { data: reflects }] = await Promise.all([
      supabase.from('profiles').select('share_memory_details, display_name').eq('id', partnerId).maybeSingle(),
      supabase
        .from('reflects')
        .select('id, body, local_date')
        .eq('user_id', partnerId)
        .eq('shared_to_friends', true)
        .gte('local_date', sinceDate)
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    const shares = !!partnerProf?.share_memory_details
    const reflectIds = (reflects || []).map((r) => r.id)
    let itemLines = []
    if (reflectIds.length > 0) {
      const { data: mems } = await supabase
        .from('item_memories')
        .select('item_id, reflect_id')
        .eq('user_id', partnerId)
        .in('reflect_id', reflectIds)
      itemLines = (mems || []).map((m) => m.item_id.split('.').pop().replace(/_/g, ' '))
    }

    const parts = []
    if (itemLines.length > 0) parts.push(`Items they logged: ${[...new Set(itemLines)].join(', ')}`)
    if (shares) {
      for (const r of reflects || []) {
        if (r.body) parts.push(`[${r.local_date}] ${r.body}`)
      }
    }
    if (parts.length === 0) {
      return NextResponse.json({ success: true, paired: true, insights: null, reason: 'no_input' })
    }

    const res = await callAI({
      systemInstruction: INSIGHTS_SYSTEM_PROMPT,
      userText: parts.join('\n\n').slice(0, MAX_CHARS),
      generationConfig: { temperature: 0.6, maxOutputTokens: 2000 },
    })
    const parsed = parseAIJson(res.text)
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
    }
    const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, 500) : null)
    const insights = {
      emotion: clean(parsed.emotion),
      topic: clean(parsed.topic),
      careTips: clean(parsed.careTips),
      boundaries: clean(parsed.boundaries),
      hangoutIdeas: clean(parsed.hangoutIdeas),
    }

    // Cache; a race just means one wasted AI call, the PK keeps one row.
    await supabase.from('connection_insights').upsert(
      { user_a: ua, user_b: ub, for_date: date, for_user: userId, payload: insights },
      { onConflict: 'user_a,user_b,for_date,for_user' },
    )

    return NextResponse.json({ success: true, paired: true, insights, cached: false })
  } catch (err) {
    console.error('[friends/insights] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
