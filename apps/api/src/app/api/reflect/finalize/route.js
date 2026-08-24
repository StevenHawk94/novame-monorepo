import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { XP_RULES } from '@novame/engine'

import { isoWeek, serviceClient } from '@/lib/reflect-draft'
import { runReflectAnalyzer, REFLECT_ANALYZER_VERSION } from '@/lib/reflect-ai'
import { loadReflectAnalyzerContext, persistReflectAnalyzerResult } from '@/lib/reflect-analysis-store'
import { recordAIUsage } from '@/lib/ai-usage'

export const runtime = 'edge'

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

    const safeMemories = Array.isArray(memories) ? memories.slice(0, 100).map((memory) => ({
      itemId: typeof memory?.itemId === 'string' ? memory.itemId : '',
      text: typeof memory?.text === 'string' ? memory.text.slice(0, 500) : '',
      source: ['manual', 'ai', 'use_my_words'].includes(memory?.source) ? memory.source : 'manual',
    })).filter((memory) => memory.itemId) : []
    const safeVisibility = Array.isArray(visibility) ? visibility.slice(0, 100).map((entry) => ({
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

    // The analyzer needs a permanent reflect id. It runs only after the atomic
    // commit; failure is non-fatal and never rolls back the user's reflection.
    if (!result?.already_finalized && draft.body?.trim()) {
      try {
        const { data: profile } = await supabase.from('profiles')
          .select('subscription_tier, ai_consent_at').eq('id', userId).single()
        if ((profile?.subscription_tier || 'free') !== 'free' && profile?.ai_consent_at) {
          const context = await loadReflectAnalyzerContext(supabase, {
            userId, visibleToFriend: true, localDate: draft.local_date,
          })
          const analyzer = await runReflectAnalyzer({
            reflectId: result.reflect_id,
            journal: draft.body,
            matchedIcons: (draft.matches || []).map((item) => ({ id: item.itemId, name: item.displayName })),
            weeklyEligible: draft.body.trim().length >= 100,
            connectionEnabled: context.connectionEnabled,
            currentConnectionBoard: context.connectionEnabled ? context.currentBoard : null,
            writerRecentEvidence: context.writerRecentEvidence,
            readerRecentEvidence: context.readerRecentEvidence,
          })
          await Promise.all([
            persistReflectAnalyzerResult(supabase, {
              reflectId: result.reflect_id, userId, localDate: draft.local_date,
              reflectsToday: Number(result.reflects_today || 1), analyzer, context,
              matchedItems: draft.matches || [],
            }),
            recordAIUsage(supabase, {
              userId, feature: 'reflect_analyzer', promptVersion: REFLECT_ANALYZER_VERSION,
              result: analyzer.result, latencyMs: analyzer.latencyMs, refId: result.reflect_id,
            }),
          ])
        }
      } catch (error) {
        console.warn('[reflect/finalize] analyzer failed (non-fatal):', error?.message || error)
      }
    }

    await supabase.rpc('broadcast_reflect_feed_change', { p_user_id: userId })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[reflect/finalize] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
