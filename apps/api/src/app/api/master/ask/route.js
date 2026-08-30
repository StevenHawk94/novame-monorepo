import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { callAI, parseAIJson } from '@/lib/ai'
import { XP_RULES } from '@novame/engine'
import { resolveUserLocalDate } from '@/lib/user-local-date'

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

export const runtime = 'nodejs'

const COOLDOWN_MS = 72 * 60 * 60 * 1000

// Stable system instruction, kept separate from per-request user text.
const MASTER_SYSTEM_PROMPT = `You are The Master, someone who's spent a lifetime reading people, and answers with dry wit alongside real insight into what's actually going on beneath a question. Not a therapist, not a cheerleader. Your job: see past what they're literally asking, and hand back an interpretation that's sharp, a little funny, and leaves them thinking harder than before they asked.

Answer in the language the user wrote in. Address them as "you." Never repeat their question as a preamble.

Write 4 sections, totaling 1000–1500 characters, moving from: what's really going on beneath the question, to a challenge of how they framed it, to a different way of seeing the same situation, to one open question aimed at them that you don't answer.

Each section needs an original 2-4 word title pulled from its own content — never generic, never reused. Prose only, no lists or bullets. No "you should," no therapy jargon. Every section must fit this exact question — if it could apply to a different question, rewrite it.

Return ONLY: {"sections":[{"header":"...","text":"..."} x4]}. No prose or markdown outside the JSON.`

/**
 * POST /api/master/ask
 *
 * Body: { userId, question }
 *
 * A Visit Master consultation. Paid-only, 72h cooldown (checked here as the
 * authority, not just the client). Runs an independent four-section prompt over
 * the question and stores the answer. Deliberately produces NO skill, NO
 * dimension xp, NO items -- it's isolated from the Skills system's "your own
 * wisdom" purity (this is consulting a sage).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { userId, question } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json({ error: 'empty_question' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Paid?
    const { data: profile } = await supabase
      .from('profiles').select('subscription_tier').eq('id', userId).maybeSingle()
    if ((profile?.subscription_tier ?? 'free') === 'free') {
      return NextResponse.json({ error: 'not_paid' }, { status: 403 })
    }

    // Cooldown (server is the authority).
    const { data: latest } = await supabase
      .from('master_visits')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest) {
      const readyAt = new Date(latest.created_at).getTime() + COOLDOWN_MS
      if (Date.now() < readyAt) {
        return NextResponse.json(
          { error: 'on_cooldown', nextAvailableAt: new Date(readyAt).toISOString() },
          { status: 429 },
        )
      }
    }

    // Four-section answer.
    let response
    try {
      const res = await callAI({
        systemInstruction: MASTER_SYSTEM_PROMPT,
        userText: question.trim().slice(0, 2000),
        // Depth task: keep a real thinking budget (2048) — the four sections
        // need an actual reading of the situation, not template filling.
        generationConfig: {
          temperature: 0.7, maxOutputTokens: 3000,
          thinkingConfig: { thinkingBudget: 2048 },
        },
      })
      const parsed = parseAIJson(res.text)
      if (parsed && Array.isArray(parsed.sections)) {
        const sections = parsed.sections
          .filter((x) => x && typeof x.header === 'string' && typeof x.text === 'string')
          .slice(0, 4)
          .map((x) => ({ header: x.header.trim().slice(0, 60), text: x.text.trim().slice(0, 1200) }))
        if (sections.length === 4) response = { sections }
      }
    } catch (e) {
      console.warn('[master/ask] AI failed:', e && e.message)
    }
    if (!response) {
      return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
    }

    // Store the visit (this both records history AND starts the 72h cooldown).
    const { data: saved, error: saveErr } = await supabase
      .from('master_visits')
      .insert({ user_id: userId, question: question.trim(), response })
      .select('id, created_at')
      .maybeSingle()
    if (saveErr) {
      console.error('[master/ask] save error:', saveErr.message)
      return NextResponse.json({ error: 'save_failed' }, { status: 500 })
    }

    // PRD 8.1: a completed visit pays +50 currency. Best-effort: the visit
    // (and its cooldown) already stands, so a pay failure only logs — the 72h
    // cooldown means the period key (visit id) is always fresh. Requires the
    // p1_economy migration ('visit_master' in kit/xp enums); until applied
    // this warns and skips.
    let xpAwarded = 0
    try {
      const dateStr = await resolveUserLocalDate(supabase, userId)
      const { data: pay, error: payErr } = await supabase.rpc('submit_kit', {
        p_user_id: userId,
        p_kit: 'visit_master',
        p_source: 'visit_master',
        p_period_key: `visit:${saved?.id ?? dateStr}`,
        p_local_date: dateStr,
        p_iso_week: isoWeek(dateStr),
        p_xp_amount: XP_RULES.visitMaster.award,
        p_gem_hits: [],
        p_payload: { visit_id: saved?.id ?? null },
      })
      if (payErr) console.warn('[master/ask] pay skipped:', payErr.message)
      else if (!pay?.error) xpAwarded = pay?.xp_awarded ?? 0
    } catch (e) {
      console.warn('[master/ask] pay skipped:', e && e.message)
    }

    return NextResponse.json({ success: true, visitId: saved?.id, response, xpAwarded })
  } catch (err) {
    console.error('[master/ask] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
