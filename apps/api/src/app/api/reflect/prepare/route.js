import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { recordAIUsage } from '@/lib/ai-usage'
import { REFLECT_COPY_VERSION } from '@/lib/reflect-ai'
import { createMemoryCopy, resolveDraftInput, serviceClient } from '@/lib/reflect-draft'

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
    const [{ data: profile }, { count: used }] = await Promise.all([
      supabase.from('profiles').select('subscription_tier, ai_consent_at').eq('id', input.userId).single(),
      supabase.from('reflects').select('id', { count: 'exact', head: true })
        .eq('user_id', input.userId).eq('local_date', localDate),
    ])
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 })
    if ((used || 0) >= 3) {
      return NextResponse.json({ error: 'daily_limit_reached', used }, { status: 409 })
    }
    const isPaid = (profile.subscription_tier || 'free') !== 'free'
    if (input.friendUserId && !isPaid) {
      return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    }
    if (input.friendUserId) {
      const { data: pairing } = await supabase.from('pairings').select('partner_user_id')
        .eq('user_id', input.userId).maybeSingle()
      if (pairing?.partner_user_id !== input.friendUserId) {
        return NextResponse.json({ error: 'pairing_required' }, { status: 409 })
      }
    }

    const draftPayload = {
      user_id: input.userId,
      idempotency_key: input.idempotencyKey.slice(0, 100),
      prompt_id: input.promptId,
      body: resolved.body,
      local_date: localDate,
      mode: resolved.mode,
      source_kit: input.sourceKit === 'new_lens' ? 'new_lens' : null,
      friend_user_id: input.friendUserId || null,
      matches: resolved.matches,
    }
    const { data: existing } = await supabase.from('reflect_drafts').select('*')
      .eq('user_id', input.userId).eq('idempotency_key', draftPayload.idempotency_key).maybeSingle()
    if (existing) {
      return NextResponse.json({
        success: true, draftId: existing.id, matches: existing.matches || [],
        aiMemories: existing.ai_memories || {}, bubble: existing.bubble || null,
        isPaid, reflectsRemaining: Math.max(0, 3 - (used || 0)),
      })
    }

    let adoptedExisting = false
    let { data: draft, error: insertError } = await supabase.from('reflect_drafts')
      .insert(draftPayload).select('*').single()
    // Double taps/retries with the same client key race safely: the unique key
    // is authoritative, and the losing request adopts the winner's draft.
    if (insertError?.code === '23505') {
      adoptedExisting = true
      const retry = await supabase.from('reflect_drafts').select('*')
        .eq('user_id', input.userId).eq('idempotency_key', draftPayload.idempotency_key).maybeSingle()
      draft = retry.data
      insertError = retry.error
    }
    if (insertError || !draft) {
      console.error('[reflect/prepare] draft insert:', insertError?.message)
      return NextResponse.json({ error: 'prepare_failed' }, { status: 500 })
    }

    // A concurrent request may already have completed the optional AI pass.
    // Returning it is cheaper and keeps retries byte-for-byte consistent.
    if (adoptedExisting || (draft.ai_memories && Object.keys(draft.ai_memories).length > 0)) {
      return NextResponse.json({
        success: true,
        draftId: draft.id,
        matches: draft.matches || resolved.matches,
        aiMemories: draft.ai_memories,
        bubble: draft.bubble || null,
        isPaid,
        reflectsRemaining: Math.max(0, 3 - (used || 0)),
      })
    }

    let aiMemories = {}
    let bubble = null
    if (isPaid && profile.ai_consent_at && resolved.body) {
      try {
        const generated = await createMemoryCopy({
          body: resolved.body,
          matches: resolved.matches,
          generateBunny: resolved.mode === 'typing',
        })
        aiMemories = generated.memories
        bubble = generated.bubble
        await Promise.all([
          supabase.from('reflect_drafts').update({ ai_memories: aiMemories, bubble })
            .eq('id', draft.id).eq('user_id', input.userId),
          generated.error
            ? recordAIUsage(supabase, {
              userId: input.userId, feature: 'reflect_copy', promptVersion: REFLECT_COPY_VERSION,
              success: false, refId: draft.id,
              error: generated.error?.message || String(generated.error),
            })
            : generated.usage ? recordAIUsage(supabase, {
              userId: input.userId, feature: 'reflect_copy', promptVersion: REFLECT_COPY_VERSION,
              result: generated.usage.result, latencyMs: generated.usage.latencyMs, refId: draft.id,
            }) : Promise.resolve(),
        ])
      } catch (error) {
        console.warn('[reflect/prepare] copy failed (non-fatal):', error?.message || error)
      }
    }

    return NextResponse.json({
      success: true,
      draftId: draft.id,
      matches: resolved.matches,
      aiMemories,
      bubble,
      isPaid,
      reflectsRemaining: Math.max(0, 3 - (used || 0)),
    })
  } catch (error) {
    console.error('[reflect/prepare] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
