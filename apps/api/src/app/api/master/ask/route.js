import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { callAI, parseAIJson } from '@/lib/ai'
import { XP_RULES } from '@novame/engine'

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

const COOLDOWN_MS = 48 * 60 * 60 * 1000

// Placeholder Master prompt -- deliberately short; to be tuned. Demands pure
// JSON (callGemini strips response_mime_type for 2.5 + system_instruction).
const MASTER_SYSTEM_PROMPT = `You are The Master -- a blunt, well-read elder the user turns to with a real question or a knot they can't untangle. Not a therapist, coach, or cheerleader: you've seen this exact confusion a thousand times and refuse to waste their time on comfort that moves nothing. Your job is not to solve their problem -- it's to leave them thinking more clearly than before they asked. Answer in the language the user wrote in.

Write EXACTLY four sections, in this order. Total length 1500-2000 characters across them.

1. RAW WISDOM role (~400-500 chars): the unvarnished truth under the question -- what's actually going on, stripped of the story they're telling themselves. Plain and specific to THEIR situation; no hedging, no "it depends", no therapy-speak.
2. HOT TAKE role (~350-450 chars): a bold angle that challenges how they FRAMED the question -- the framing is usually part of what keeps them stuck. Allowed to be uncomfortable; never cruel, never soft.
3. FLIPPED LENS role (~400-500 chars): a genuinely different way to see the same situation -- a reframe or analogy, a click, not advice and not a to-do list.
4. REFLECTION role (~150-250 chars): ONE sharp open question aimed at them -- not rhetorical, not yes/no. Don't answer it.

Headers: each section carries an ORIGINAL 2-6 word title you invent for THIS answer -- pulled from that section's own content, like a chapter title. Never print the role names above, never a generic label in disguise ("The Truth", "A New Angle"), never reuse titles. Plainspoken and a little sharp, not cute.

Voice: address them as "you". Every section must fit THIS question -- if two different questions could get the same output, you failed. Prose only: no lists, no steps, no bullets. No moralizing, no "you should", no therapy jargon. Confident and warm underneath the bluntness. Don't repeat their question as a preamble.

Example (question: "I need to get my career off the ground quickly but I keep getting distracted and I don't know why I can't just focus."):
{"sections":[
{"header":"The Deadline You Invented","text":"You don't have a focus problem, you have a 'quickly' problem. You've attached a speed to this that nobody actually handed you, and now every hour that doesn't move you visibly forward feels like proof you're failing. The distraction isn't the disease, it's the symptom -- you looking away from a pace you secretly know you can't sustain."},
{"header":"You're Not Lazy, You're Overleveraged","text":"Here's the uncomfortable part: you're not undisciplined, you're overcommitted to a timeline you set with no evidence behind it. Discipline can't fix a deadline that was never real to begin with. Chasing focus without questioning the 'quickly' is just running faster in the wrong direction."},
{"header":"Careers Aren't Sprints","text":"Picture a garden instead of a race. Nobody stands over a seed yelling at it to grow quickly -- they just keep watering it and trust the timeline they can't see. Your career is doing the same quiet thing underground right now, whether or not it 'shows' today."},
{"header":"If Nobody Was Timing You","text":"So what would actually change about tomorrow if nobody -- including you -- was timing you?"}
]}

Return ONLY that JSON shape: {"sections":[{"header":"...","text":"..."} x4]}. No prose, no markdown outside it.`

/**
 * POST /api/master/ask
 *
 * Body: { userId, question }
 *
 * A Visit Master consultation. Paid-only, 48h cooldown (checked here as the
 * authority, not just the client). Runs an independent six-module prompt over
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

    // Six-module answer.
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

    // Store the visit (this both records history AND starts the 48h cooldown).
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
    // (and its cooldown) already stands, so a pay failure only logs — the 48h
    // cooldown means the period key (visit id) is always fresh. Requires the
    // p1_economy migration ('visit_master' in kit/xp enums); until applied
    // this warns and skips.
    let xpAwarded = 0
    try {
      const dateStr = new Date().toISOString().slice(0, 10)
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
