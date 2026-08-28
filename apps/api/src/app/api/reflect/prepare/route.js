import { after, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { XP_RULES, ITEM_CATALOG_VERSION } from '@novame/engine'
import { createMemoryFallbacks, isoWeek, resolveDraftInput, serviceClient } from '@/lib/reflect-draft'
import { generateSavedReflectCopy } from '@/lib/reflect-settlement'

export const runtime = 'edge'

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = await request.json()
    if (verified.id !== input.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!Number.isInteger(input.promptId) || input.promptId < 1 || input.promptId > 9) {
      return NextResponse.json({ error: 'invalid_prompt' }, { status: 400 })
    }
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 8) {
      return NextResponse.json({ error: 'invalid_idempotency_key' }, { status: 400 })
    }
    const supabase = serviceClient()
    const resolved = await resolveDraftInput(supabase, input)
    if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: 400 })
    const localDate = /^\d{4}-\d{2}-\d{2}$/.test(input.localDate || '')
      ? input.localDate : new Date().toISOString().slice(0, 10)
    const { data: profile } = await supabase.from('profiles')
      .select('subscription_tier, ai_consent_at').eq('id', input.userId).single()
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 })
    const isPaid = (profile.subscription_tier || 'free') !== 'free'
    if (input.friendUserId && !isPaid) return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    const payload = {
      user_id: input.userId, idempotency_key: input.idempotencyKey.slice(0, 100),
      prompt_id: input.promptId, body: resolved.body, local_date: localDate, mode: resolved.mode,
      source_kit: input.sourceKit === 'new_lens' ? 'new_lens' : null,
      friend_user_id: input.friendUserId || null, matches: resolved.matches,
    }
    // Permanent record, daily quota and reward commit BEFORE spending tokens.
    // Retrying a previously saved key succeeds even when today's quota is full.
    const { data: reserved, error } = await supabase.rpc('begin_saved_reflect', {
      p_user_id: input.userId, p_payload: payload, p_xp: XP_RULES.reflect.award,
      p_week: isoWeek(localDate),
      p_memories: isPaid && profile.ai_consent_at && resolved.body
        ? createMemoryFallbacks({ body: resolved.body, matches: resolved.matches }) : {},
    })
    if (error) throw error
    if (reserved?.error) return NextResponse.json(reserved, {
      status: reserved.error === 'daily_limit_reached' ? 409 : 400,
    })
    let draft = reserved?.draft
    if (!draft) throw new Error('save_not_confirmed')
    // Admin evidence only. Confirmed removal never changes matching rules.
    // Do not accept client-provided keywords or store the journal in this queue.
    const reflectId = draft.saved_reflect_id || draft.finalized_reflect_id
    if (reflectId && resolved.removedMatches?.length && draft.body === resolved.body) {
      const rows = resolved.removedMatches.flatMap(item => (item.matchedKeywords || []).slice(0, 10).map(keyword => ({
        reflect_id: reflectId, item_id: item.itemId, icon_name: item.displayName,
        keyword, catalog_version: ITEM_CATALOG_VERSION, rule_revision: input.matchingVersion?.revision || 0,
      })))
      after(async () => {
        if (!rows.length) return
        const { error: feedbackError } = await supabase.from('item_match_removals').upsert(rows, {
          onConflict: 'reflect_id,item_id,keyword', ignoreDuplicates: true,
        })
        if (feedbackError) console.warn('[item-learning] removal feedback failed:', feedbackError.message)
      })
    }
    if (isPaid && profile.ai_consent_at && draft.body) {
      draft = await generateSavedReflectCopy(supabase, draft, input.userId)
    }
    return NextResponse.json({
      success: true, draftId: draft.id, reflectId: draft.saved_reflect_id || draft.finalized_reflect_id,
      localDate: draft.local_date, revision: draft.settlement_revision || 0,
      memories: draft.settlement_memories, matches: draft.matches || [],
      aiMemories: draft.ai_memories || {}, bubble: draft.bubble || null,
      isPaid, reflectsRemaining: draft.save_receipt?.reflects_remaining ?? 0,
    })
  } catch (error) {
    console.error('[reflect/prepare] failed:', error?.message || error)
    return NextResponse.json({ error: 'prepare_failed' }, { status: 500 })
  }
}
