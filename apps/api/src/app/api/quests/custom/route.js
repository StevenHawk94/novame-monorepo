import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { callAI, parseAIJson } from '@/lib/ai'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const CUSTOM_PLAN_PROMPT = `You create a practical 7-day action plan to help someone make progress toward their stated goal.

Based only on the user’s clearly stated goal, generate exactly 20 distinct, concrete actions they can complete during the next seven days. The actions should collectively move the user meaningfully toward that goal, with a realistic mix of preparation, execution, practice, review, and follow-through when relevant.

Requirements:
- Each task must be one specific, finishable action that can be completed in a single day.
- Use imperative voice.
- Keep every task under 12 words.
- Make tasks measurable whenever possible, using clear quantities, durations, or outputs.
- Avoid vague or generic actions such as “stay motivated,” “work harder,” “be consistent,” or “improve yourself.”
- Do not repeat tasks or create near-duplicates.
- Do not invent goals, circumstances, tools, or resources the user did not mention.
- Do not include explanations, categories, dates, or numbering.

Return ONLY valid JSON:
{ "tasks": ["task one", "task two"] }`

const CACHE_HOURS = 24
const GENERATION_LOCK_MINUTES = 5
const FAILURE_CACHE_MINUTES = 1

function normalizeTasks(parsed) {
  const arr = Array.isArray(parsed) ? parsed : parsed?.tasks
  if (!Array.isArray(arr)) return null

  const seen = new Set()
  const tasks = []
  for (const value of arr) {
    if (typeof value !== 'string') continue
    const task = value.trim().replace(/\s+/g, ' ').slice(0, 120)
    if (!task) continue
    const key = task.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    tasks.push(task)
  }

  return tasks.length === 20 ? tasks : null
}

/**
 * GET /api/quests/custom?userId=...
 *
 * Read-only cache lookup. This endpoint never calls AI; it exists so reopening
 * Custom Goal can restore the previous successful candidates for 24 hours.
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userId = new URL(request.url).searchParams.get('userId') || ''
    if (!userId || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const nowIso = new Date().toISOString()

    await supabase
      .from('quest_custom_generations')
      .delete()
      .eq('user_id', userId)
      .lte('expires_at', nowIso)

    const { data: cached, error } = await supabase
      .from('quest_custom_generations')
      .select('status, tasks, generated_at, expires_at')
      .eq('user_id', userId)
      .gt('expires_at', nowIso)
      .maybeSingle()

    if (error) {
      console.error('[quests/custom] cache lookup failed:', error.message)
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
    if (cached?.status === 'ready' && Array.isArray(cached.tasks) && cached.tasks.length > 0) {
      return NextResponse.json({
        success: true,
        tasks: cached.tasks,
        cached: true,
        generatedAt: cached.generated_at,
        expiresAt: cached.expires_at,
      })
    }

    return NextResponse.json({ success: true, tasks: null, cached: false })
  } catch (err) {
    console.error('[quests/custom] cache lookup unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST /api/quests/custom
 *
 * Body: { userId, goal }
 *
 * Plus-only. Turns a free-text goal into ~20 candidate daily tasks via the AI
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

    const now = new Date()
    const nowIso = now.toISOString()

    // Expired results and abandoned generation locks are disposable. Clearing
    // them here avoids needing a scheduled cleanup job.
    await supabase
      .from('quest_custom_generations')
      .delete()
      .eq('user_id', userId)
      .lte('expires_at', nowIso)

    const { data: cached } = await supabase
      .from('quest_custom_generations')
      .select('status, tasks, generated_at, expires_at')
      .eq('user_id', userId)
      .gt('expires_at', nowIso)
      .maybeSingle()

    if (cached?.status === 'ready' && Array.isArray(cached.tasks) && cached.tasks.length > 0) {
      return NextResponse.json({
        success: true,
        tasks: cached.tasks,
        cached: true,
        generatedAt: cached.generated_at,
        expiresAt: cached.expires_at,
      })
    }
    if (cached?.status === 'generating') {
      return NextResponse.json({ error: 'generation_in_progress' }, { status: 409 })
    }
    if (cached?.status === 'failed') {
      const failedAt = new Date(cached.generated_at).getTime()
      const failureCooldownMs = FAILURE_CACHE_MINUTES * 60 * 1000
      if (Number.isFinite(failedAt) && now.getTime() - failedAt < failureCooldownMs) {
        return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
      }

      // Also clear failures written by older deployments whose expires_at was
      // incorrectly set to 24 hours, so they do not keep users locked out.
      await supabase
        .from('quest_custom_generations')
        .delete()
        .eq('user_id', userId)
        .eq('status', 'failed')
    }

    // Secondary abuse backstop for failed AI attempts. Successful generations
    // are protected by the 24-hour database cache below.
    const rl = await rateLimit(supabase, `quest-custom:${userId}`, 3, 3600)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
    }

    // Claim the user's one generation slot before calling AI. The user_id
    // primary key prevents two devices/requests from spending tokens together.
    const generationToken = crypto.randomUUID()
    const lockExpiresAt = new Date(now.getTime() + GENERATION_LOCK_MINUTES * 60 * 1000).toISOString()
    const { error: claimError } = await supabase
      .from('quest_custom_generations')
      .insert({
        user_id: userId,
        goal: goal.trim().slice(0, 500),
        status: 'generating',
        generation_token: generationToken,
        expires_at: lockExpiresAt,
      })

    if (claimError) {
      if (claimError.code !== '23505') {
        console.error('[quests/custom] failed to claim generation slot:', claimError.message)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
      }
      // Another request won the race. Return its completed result when
      // available; otherwise tell the client that generation is still active.
      const { data: raced } = await supabase
        .from('quest_custom_generations')
        .select('status, tasks, generated_at, expires_at')
        .eq('user_id', userId)
        .gt('expires_at', nowIso)
        .maybeSingle()
      if (raced?.status === 'ready' && Array.isArray(raced.tasks)) {
        return NextResponse.json({
          success: true,
          tasks: raced.tasks,
          cached: true,
          generatedAt: raced.generated_at,
          expiresAt: raced.expires_at,
        })
      }
      if (raced?.status === 'failed') {
        return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
      }
      return NextResponse.json({ error: 'generation_in_progress' }, { status: 409 })
    }

    // Generate candidate tasks.
    let tasks
    try {
      const res = await callAI({
        systemInstruction: CUSTOM_PLAN_PROMPT,
        userText: `My goal: ${goal.trim().slice(0, 500)}`,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1200,
          response_mime_type: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      })
      const parsed = parseAIJson(res.text)
      tasks = normalizeTasks(parsed)
    } catch (e) {
      console.warn('[quests/custom] AI failed:', e && e.message)
    }

    if (!tasks || tasks.length === 0) {
      const failedAt = new Date()
      await supabase
        .from('quest_custom_generations')
        .update({
          status: 'failed',
          generated_at: failedAt.toISOString(),
          // Failures are transient and must not consume the user's daily
          // generation slot. Keep a short cooldown to prevent rapid retries;
          // only a successful result is cached for the full 24 hours.
          expires_at: new Date(
            failedAt.getTime() + FAILURE_CACHE_MINUTES * 60 * 1000,
          ).toISOString(),
        })
        .eq('user_id', userId)
        .eq('generation_token', generationToken)
      return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
    }

    const generatedAt = new Date()
    const expiresAt = new Date(generatedAt.getTime() + CACHE_HOURS * 60 * 60 * 1000)
    const { error: saveError } = await supabase
      .from('quest_custom_generations')
      .update({
        tasks,
        status: 'ready',
        generated_at: generatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq('user_id', userId)
      .eq('generation_token', generationToken)

    if (saveError) {
      console.error('[quests/custom] failed to save generation:', saveError.message)
      await supabase
        .from('quest_custom_generations')
        .delete()
        .eq('user_id', userId)
        .eq('generation_token', generationToken)
      return NextResponse.json({ error: 'ai_unavailable' }, { status: 503 })
    }

    return NextResponse.json({
      success: true,
      tasks,
      cached: false,
      generatedAt: generatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
  } catch (err) {
    console.error('[quests/custom] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
