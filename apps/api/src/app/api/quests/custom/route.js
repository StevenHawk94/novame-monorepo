import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { callAI, parseAIJson } from '@/lib/ai'

export const runtime = 'nodejs'

// Simple first-pass prompt (tune later, like the Master prompt). Asks for a flat
// JSON object with a `tasks` array so parseAIJson stays robust.
const CUSTOM_PLAN_PROMPT = `You help someone build a personal 7-day self-improvement plan. Given their goal, generate exactly 10 short, concrete, doable daily tasks -- each a single action they could finish in one day. Keep each under 12 words, imperative voice (e.g. "Do 20 push-ups", "Read 10 pages"). No numbering, no duplicates, no vague tasks.

Return ONLY a JSON object, no markdown, no prose outside it:
{ "tasks": ["task one", "task two"] }`

/**
 * POST /api/quests/custom
 *
 * Body: { userId, goal }
 *
 * Plus-only. Turns a free-text goal into ~10 candidate daily tasks via the AI
 * layer (Gemini -> DeepSeek fallback). Generation only -- it does NOT create a
 * plan; the client lets the user pick 7 and then calls /api/quests/start with
 * themeKey 'custom'. Plus gate mirrors master/ask (profiles.subscription_tier).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { userId, goal } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
      return NextResponse.json({ error: 'empty_goal' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Plus gate -- same field the other AI features (master/ask, reflect) use.
    const { data: profile } = await supabase
      .from('profiles').select('subscription_tier').eq('id', userId).maybeSingle()
    if ((profile?.subscription_tier ?? 'free') === 'free') {
      return NextResponse.json({ error: 'not_paid' }, { status: 403 })
    }

    // Generate candidate tasks.
    let tasks
    try {
      const res = await callAI({
        systemInstruction: CUSTOM_PLAN_PROMPT,
        userText: `My goal: ${goal.trim().slice(0, 500)}`,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
      })
      const parsed = parseAIJson(res.text)
      const arr = Array.isArray(parsed) ? parsed : parsed?.tasks
      if (Array.isArray(arr)) {
        tasks = arr
          .filter((t) => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 120))
          .slice(0, 10)
      }
    } catch (e) {
      console.warn('[quests/custom] AI failed:', e && e.message)
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
    }

    return NextResponse.json({ success: true, tasks })
  } catch (err) {
    console.error('[quests/custom] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
