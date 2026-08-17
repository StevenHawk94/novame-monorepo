import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { loadWeeklyContext, weeklyResponse } from '@/lib/weekly-recap'
import { runWeeklyRecap, WEEKLY_RECAP_VERSION } from '@/lib/reflect-ai'
import { recordAIUsage } from '@/lib/ai-usage'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request) {
  try {
    const verified = await verifyToken((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim())
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, periodStart, periodEnd } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: viewer } = await supabase.from('profiles').select('subscription_tier, ai_consent_at').eq('id', userId).maybeSingle()
    if ((viewer?.subscription_tier || 'free') === 'free' || !viewer?.ai_consent_at) return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    const context = await loadWeeklyContext(supabase, userId)
    const period = context.periods?.find((p) => p.startDate === periodStart && p.endDate === periodEnd)
    if (!period || context.generatedMap.has(`${periodStart}:${periodEnd}`)) return NextResponse.json(weeklyResponse(context))
    const result = await runWeeklyRecap({
      period: { startDate: periodStart, endDate: periodEnd }, scores: period.scores,
      evidence: period.evidence.map((row) => row.weekly_evidence),
    })
    await Promise.all([
      supabase.from('weekly_recaps').upsert({
        user_a: context.ua, user_b: context.ub, for_user: userId, writer_user_id: context.writerId,
        period_start: periodStart, period_end: periodEnd, evidence_count: period.evidenceCount,
        scores: period.scores, payload: result.data, prompt_version: WEEKLY_RECAP_VERSION,
        provider: result.result.provider, model: result.result.model, usage: result.result.usage || null,
      }, { onConflict: 'user_a,user_b,for_user,period_start,period_end' }),
      recordAIUsage(supabase, { userId: context.writerId, feature: 'weekly_recap', promptVersion: WEEKLY_RECAP_VERSION,
        result: result.result, latencyMs: result.latencyMs, refId: `${periodStart}:${periodEnd}` }),
    ])
    return NextResponse.json(weeklyResponse(await loadWeeklyContext(supabase, userId)))
  } catch (err) {
    console.error('[patterns/generate]', err?.message)
    return NextResponse.json({ error: 'generation_failed' }, { status: 500 })
  }
}
