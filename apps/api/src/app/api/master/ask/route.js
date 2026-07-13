import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { callAI, parseAIJson } from '@/lib/ai'

export const runtime = 'nodejs'

const COOLDOWN_MS = 48 * 60 * 60 * 1000

// Placeholder Master prompt -- deliberately short; to be tuned. Demands pure
// JSON (callGemini strips response_mime_type for 2.5 + system_instruction).
const MASTER_SYSTEM_PROMPT = `You are the Master: a warm, wise, unhurried guide. A person shares what's on their mind. Respond with genuine insight, not platitudes -- see what they might not see, and offer one small, doable step. This is a consultation, not a lecture.

Return ONLY a JSON object, no markdown, no prose outside it:
{
  "quote_short": "one distilled line of insight, under 15 words",
  "insight_full": "a full reading of their situation, 2-3 sentences, specific and warm",
  "flipped_lens": "one sentence offering the reverse angle -- what if the opposite were true",
  "micro_task": "one small action they can take today, one sentence",
  "reflective_question": "one open question that invites them to keep thinking"
}`

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
        generationConfig: { temperature: 0.6, maxOutputTokens: 2000 },
      })
      const parsed = parseAIJson(res.text)
      if (parsed && typeof parsed === 'object' && parsed.insight_full) {
        response = {
          quote_short: parsed.quote_short || '',
          insight_full: parsed.insight_full || '',
          flipped_lens: parsed.flipped_lens || '',
          micro_task: parsed.micro_task || '',
          reflective_question: parsed.reflective_question || '',
        }
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

    return NextResponse.json({ success: true, visitId: saved?.id, response })
  } catch (err) {
    console.error('[master/ask] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
