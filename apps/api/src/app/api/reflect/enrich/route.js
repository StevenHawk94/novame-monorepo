import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { serviceClient } from '@/lib/reflect-draft'
import { generateSavedReflectCopy } from '@/lib/reflect-settlement'

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
    if (!draft.saved_reflect_id) return NextResponse.json({ error: 'saved_reflect_required' }, { status: 409 })
    let eligibleDraft = draft
    if (profile?.ai_consent_at && draft.body?.trim() && draft.ai_enhancement_eligible !== true) {
      const reflectId = draft.saved_reflect_id || draft.finalized_reflect_id
      const { data: allowance, error: allowanceError } = await supabase.rpc(
        'claim_reflect_ai_enhancement',
        { p_user_id: userId, p_reflect_id: reflectId },
      )
      if (allowanceError || allowance?.error) throw allowanceError || new Error(allowance.error)
      eligibleDraft = { ...draft, ai_enhancement_eligible: allowance?.eligible === true }
    }
    const latest = eligibleDraft.ai_enhancement_eligible === true
      ? await generateSavedReflectCopy(supabase, eligibleDraft, userId) : eligibleDraft
    const allowed = new Set(Array.isArray(emptyItemIds) ? emptyItemIds : [])
    return NextResponse.json({
      success: true,
      aiMemories: Object.fromEntries(Object.entries(latest.ai_memories || {}).filter(([id]) => allowed.has(id))),
      bubble: latest.bubble || null,
    })
  } catch (error) {
    console.error('[reflect/enrich] failed:', error?.message || error)
    return NextResponse.json({ error: 'enrich_failed' }, { status: 500 })
  }
}
