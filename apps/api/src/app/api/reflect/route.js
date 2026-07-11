import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { promptDimension, DIMENSION_IDS } from '@novame/domain'
import { gemsForReflect, GEMS_PER_DIMENSION } from '@novame/engine'
import { callAI, parseAIJson } from '@/lib/ai'

export const runtime = 'edge'

const MAX_BODY_CHARS = 5000

const DIMENSION_SYSTEM_PROMPT = `You classify a personal journal entry into growth dimensions.

The eight dimensions (topics, not emotions):
- expression: speaking up, sharing something usually kept private
- awareness: noticing a pattern, self-insight, understanding why
- momentum: starting, doing, taking action, follow-through
- direction: clarity on what one wants, goals, what matters
- steadiness: handling a setback, staying grounded through difficulty
- confidence: trusting oneself, acting despite uncertainty
- gratitude: appreciating a moment, contentment
- connection: another person, empathy, relationships

Return ONLY a JSON array of 0 to 2 dimension ids the entry most strongly reflects, most relevant first. No prose, no markdown. Example: ["awareness","connection"]. If nothing clearly fits, return [].`

/**
 * AI dimension analysis (paid only). Returns up to two dimension ids from the
 * body, excluding the one the prompt already credits so the two AI slots add
 * breadth rather than repeat. Any failure -- model down, bad JSON -- degrades
 * to [], leaving the user with just the prompt dimension. The economy never
 * blocks on the AI.
 */
async function analyzeDimensions(body, excludeDim) {
  try {
    const raw = await callAI({
      systemInstruction: DIMENSION_SYSTEM_PROMPT,
      userText: body,
      generationConfig: { temperature: 0.3, maxOutputTokens: 50 },
    })
    const parsed = parseAIJson(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((d) => DIMENSION_IDS.includes(d) && d !== excludeDim))].slice(0, 2)
  } catch (err) {
    console.warn('[reflect] dimension analysis failed, degrading to prompt-only:', err && err.message)
    return []
  }
}

/** ISO week like 2026-W28, from a YYYY-MM-DD date string. */
function isoWeek(dateStr) {
  const parts = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * POST /api/reflect
 *
 * Body: { userId, promptId (1-9), body (<=5000 chars), localDate (YYYY-MM-DD) }
 *
 * Computes XP and gem dimensions with the engine -- prompt dimension always,
 * plus AI analysis for paid+consented users -- then hands the numbers to the
 * submit_reflect RPC, which writes all five tables atomically under a lock and
 * returns a complete state snapshot. The client adopts that snapshot as-is;
 * this endpoint is the only place the numbers are decided (server authority).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, promptId, body, localDate } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!Number.isInteger(promptId) || promptId < 1 || promptId > 9) {
      return NextResponse.json({ error: 'Invalid promptId' }, { status: 400 })
    }
    if (typeof body !== 'string' || body.length === 0) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 })
    }
    if (body.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Body too long' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('subscription_tier, ai_consent_at')
      .eq('id', userId)
      .single()
    if (pErr || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    const isPaid = (profile.subscription_tier || 'free') !== 'free'
    const hasConsent = !!profile.ai_consent_at

    const pDim = promptDimension(promptId)
    let aiDimensions = []
    if (isPaid && hasConsent) {
      aiDimensions = await analyzeDimensions(body, pDim)
    }

    const gems = gemsForReflect({
      charCount: body.length,
      promptDimension: pDim,
      aiDimensions,
      isPaid,
    })
    const dimensionHits = gems.credited.map((d) => ({ dimension: d, gems: GEMS_PER_DIMENSION }))

    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const weekStr = isoWeek(dateStr)

    // XP is a flat 30. The RPC's daily gate (not this endpoint) enforces 3/day,
    // so a successful submit is always one of the first three and pays 30.
    const { data: result, error: rpcErr } = await supabase.rpc('submit_reflect', {
      p_user_id: userId,
      p_prompt_id: promptId,
      p_body: body,
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: 30,
      p_dimension_hits: dimensionHits,
    })
    if (rpcErr) {
      console.error('[reflect] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[reflect] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
