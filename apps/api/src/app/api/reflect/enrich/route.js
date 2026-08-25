import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient, createMemoryCopy } from '@/lib/reflect-draft'
import { recordAIUsage } from '@/lib/ai-usage'
import { isUsableReflectMemoryCopy, REFLECT_COPY_VERSION } from '@/lib/reflect-ai'

export const runtime = 'edge'

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, draftId, emptyItemIds } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = serviceClient()
    const [{ data: profile }, { data: draft }] = await Promise.all([
      supabase.from('profiles').select('subscription_tier, ai_consent_at').eq('id', userId).single(),
      supabase.from('reflect_drafts').select('*').eq('id', draftId).eq('user_id', userId).maybeSingle(),
    ])
    if (!draft) return NextResponse.json({ error: 'draft_not_found' }, { status: 404 })
    if ((profile?.subscription_tier || 'free') === 'free') {
      return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    }
    if (!profile?.ai_consent_at || !draft.body?.trim()) {
      return NextResponse.json({ success: true, aiMemories: {}, bubble: draft.bubble || null })
    }
    const allowed = new Set(Array.isArray(emptyItemIds)
      ? emptyItemIds.filter((itemId) => typeof itemId === 'string')
      : [])
    const existingMemories = draft.ai_memories || {}
    const targets = (draft.matches || []).filter((item) => (
      allowed.has(item.itemId) && !isUsableReflectMemoryCopy(existingMemories[item.itemId])
    ))
    const alreadyGenerated = Object.fromEntries(
      (draft.matches || [])
        .filter((item) => allowed.has(item.itemId) && isUsableReflectMemoryCopy(existingMemories[item.itemId]))
        .map((item) => [item.itemId, existingMemories[item.itemId]]),
    )
    if (targets.length === 0) {
      return NextResponse.json({
        success: true, aiMemories: alreadyGenerated, bubble: draft.bubble || null,
      })
    }
    const generated = await createMemoryCopy({
      body: draft.body,
      matches: targets,
      generateBunny: draft.mode === 'typing' && !draft.bubble,
    })
    const merged = { ...existingMemories, ...generated.memories }
    const bubble = draft.bubble || generated.bubble || null
    await Promise.all([
      supabase.from('reflect_drafts').update({ ai_memories: merged, bubble })
        .eq('id', draftId).eq('user_id', userId),
      generated.error
        ? recordAIUsage(supabase, {
          userId, feature: 'reflect_copy', promptVersion: REFLECT_COPY_VERSION,
          success: false, refId: draftId,
          error: generated.error?.message || String(generated.error),
        })
        : generated.usage ? recordAIUsage(supabase, {
          userId, feature: 'reflect_copy', promptVersion: REFLECT_COPY_VERSION,
          result: generated.usage.result, latencyMs: generated.usage.latencyMs, refId: draftId,
        }) : Promise.resolve(),
    ])
    return NextResponse.json({
      success: true,
      aiMemories: { ...alreadyGenerated, ...generated.memories },
      bubble,
    })
  } catch (error) {
    console.error('[reflect/enrich] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
