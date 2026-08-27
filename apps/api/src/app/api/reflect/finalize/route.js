import { after, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { MAX_REFLECT_ITEMS, XP_RULES } from '@novame/engine'

import { isoWeek, serviceClient } from '@/lib/reflect-draft'
import { runReflectAnalyzer, REFLECT_ANALYZER_VERSION } from '@/lib/reflect-ai'
import { loadReflectAnalyzerContext, persistReflectAnalyzerResult } from '@/lib/reflect-analysis-store'
import { recordAIUsage } from '@/lib/ai-usage'

export const runtime = 'edge'
export const maxDuration = 60

async function markConnectionRecoveryRequired(supabase, userId) {
  const { data: pairing } = await supabase.from('pairings')
    .select('partner_user_id').eq('user_id', userId).maybeSingle()
  if (!pairing?.partner_user_id) return
  await supabase.from('profiles')
    .update({ connection_resume_required: true })
    .eq('id', pairing.partner_user_id)
}

async function analyzeFinalizedReflect({ userId, draft, result }) {
  const supabase = serviceClient()
  let context = {
    connectionEligible: false, connectionEnabled: false, currentBoard: null, pair: null,
  }
  try {
    const { data: profile } = await supabase.from('profiles')
      .select('subscription_tier, ai_consent_at').eq('id', userId).single()
    if ((profile?.subscription_tier || 'free') === 'free' || !profile?.ai_consent_at) return

    context = await loadReflectAnalyzerContext(supabase, {
      userId, visibleToFriend: true, localDate: draft.local_date,
    })
    const analyzer = await runReflectAnalyzer({
      reflectId: result.reflect_id,
      journal: draft.body,
      matchedIcons: (draft.matches || []).map((item) => ({
        id: item.itemId, name: item.displayName,
      })),
      connectionEnabled: context.connectionEnabled,
      currentConnectionBoard: context.connectionEnabled ? context.currentBoard : null,
      writerRecentEvidence: context.writerRecentEvidence,
      readerRecentEvidence: context.readerRecentEvidence,
    })
    await persistReflectAnalyzerResult(supabase, {
      reflectId: result.reflect_id, userId, localDate: draft.local_date,
      reflectsToday: Number(result.reflects_today || 1), analyzer, context,
      matchedItems: draft.matches || [],
    })
    try {
      await recordAIUsage(supabase, {
        userId, feature: 'reflect_analyzer', promptVersion: REFLECT_ANALYZER_VERSION,
        result: analyzer.result, latencyMs: analyzer.latencyMs, refId: result.reflect_id,
      })
    } catch (usageError) {
      console.warn('[reflect/finalize] background usage record failed:', usageError?.message || usageError)
    }
  } catch (error) {
    const message = String(error?.message || error)
    console.warn('[reflect/finalize] background analyzer failed:', message)
    const connectionMode = !context.connectionEligible
      ? 'disabled'
      : !context.connectionEnabled
        ? 'inactive'
        : 'immediate'
    await Promise.allSettled([
      supabase.from('reflect_ai_analyses').upsert({
        reflect_id: result.reflect_id,
        user_id: userId,
        local_date: draft.local_date,
        prompt_version: REFLECT_ANALYZER_VERSION,
        weekly_eligible: false,
        connection_eligible: context.connectionEligible,
        connection_mode: connectionMode,
        status: 'failed',
        error: message.slice(0, 500),
        completed_at: new Date().toISOString(),
      }, { onConflict: 'reflect_id' }),
      recordAIUsage(supabase, {
        userId, feature: 'reflect_analyzer', promptVersion: REFLECT_ANALYZER_VERSION,
        success: false, refId: result.reflect_id, error: message,
      }),
      markConnectionRecoveryRequired(supabase, userId),
    ])
  }
}

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, draftId, memories, visibility } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = serviceClient()
    const { data: draft } = await supabase.from('reflect_drafts').select('*')
      .eq('id', draftId).eq('user_id', userId).maybeSingle()
    if (!draft) return NextResponse.json({ error: 'draft_not_found' }, { status: 404 })

    // Shared Memories is Plus-only at both prepare and final commit. Recheck
    // here because a draft may stay open while an entitlement expires or a
    // modified client may try to finalize it later.
    if (draft.friend_user_id) {
      const { data: profile } = await supabase.from('profiles')
        .select('subscription_tier').eq('id', userId).maybeSingle()
      if ((profile?.subscription_tier || 'free') === 'free') {
        return NextResponse.json({ error: 'plus_required' }, { status: 403 })
      }
    }

    if ((Array.isArray(memories) && memories.length > MAX_REFLECT_ITEMS)
      || (Array.isArray(visibility) && visibility.length > MAX_REFLECT_ITEMS)) {
      return NextResponse.json({ error: 'too_many_items' }, { status: 400 })
    }
    const safeMemories = Array.isArray(memories) ? memories.map((memory) => ({
      itemId: typeof memory?.itemId === 'string' ? memory.itemId : '',
      text: typeof memory?.text === 'string' ? memory.text.slice(0, 500) : '',
      source: ['manual', 'ai', 'use_my_words'].includes(memory?.source) ? memory.source : 'manual',
    })).filter((memory) => memory.itemId) : []
    const safeVisibility = Array.isArray(visibility) ? visibility.map((entry) => ({
      itemId: typeof entry?.itemId === 'string' ? entry.itemId : '',
      visible: entry?.visible !== false,
    })).filter((entry) => entry.itemId) : []

    const { data: result, error: rpcError } = await supabase.rpc('finalize_reflect_draft', {
      p_user_id: userId,
      p_draft_id: draftId,
      p_memories: safeMemories,
      p_visibility: safeVisibility,
      p_xp_amount: XP_RULES.reflect.award,
      p_iso_week: isoWeek(draft.local_date),
    })
    if (rpcError) {
      console.error('[reflect/finalize] rpc:', rpcError.message)
      return NextResponse.json({ error: 'finalize_failed' }, { status: 500 })
    }
    if (result?.error) {
      const status = result.error === 'daily_limit_reached' ? 409 : 400
      return NextResponse.json(result, { status })
    }

    // The analyzer needs a permanent reflect id, but it must not keep the user
    // waiting on the settlement screen. Next's after() keeps the task alive
    // after the response has been sent. A failed row + recovery flag lets the
    // next Connection visit retry only this latest reflection.
    if (!result?.already_finalized && draft.body?.trim()) {
      after(() => analyzeFinalizedReflect({ userId, draft, result }))
    }

    await supabase.rpc('broadcast_reflect_feed_change', { p_user_id: userId })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[reflect/finalize] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
