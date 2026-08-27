import { after, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { MAX_REFLECT_ITEMS, XP_RULES } from '@novame/engine'

import { isoWeek, serviceClient } from '@/lib/reflect-draft'
import { analyzeFinalizedReflect } from '@/lib/reflect-completion'
import { sanitizeSettlementMemories } from '@/lib/reflect-settlement'

export const runtime = 'edge'
export const maxDuration = 60


export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, draftId, memories, visibility, revision, useSaved } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = serviceClient()
    const { data: draft } = await supabase.from('reflect_drafts').select('*')
      .eq('id', draftId).eq('user_id', userId).maybeSingle()
    if (!draft) return NextResponse.json({ error: 'draft_not_found' }, { status: 404 })

    // Shared Memories is Plus-only at both prepare and final commit. Recheck
    // here because a draft may stay open while an entitlement expires or a
    // modified client may try to finalize it later.
    if (draft.friend_user_id && !draft.saved_reflect_id) {
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

    const visibilityById = new Map(safeVisibility.map((entry) => [entry.itemId, entry.visible]))
    const durableMemories = useSaved === true ? null : sanitizeSettlementMemories(
      (Array.isArray(memories) ? memories : []).map((m) => ({
        ...m, visible: visibilityById.has(m.itemId) ? visibilityById.get(m.itemId) : m.visible,
      })),
    )
    const { data: result, error: rpcError } = await supabase.rpc(
      draft.saved_reflect_id ? 'complete_saved_reflect' : 'finalize_reflect_draft',
      draft.saved_reflect_id ? {
        p_user_id: userId, p_draft_id: draftId, p_memories: durableMemories,
        p_revision: Number.isSafeInteger(revision) && revision > 0
          ? revision : Number(draft.settlement_revision || 0) + 1,
      } : {
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
