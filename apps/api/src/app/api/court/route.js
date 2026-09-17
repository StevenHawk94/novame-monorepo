import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { EXPIRABLE_STATUSES, LOVE_RELATIONSHIPS, courtServiceClient, loadCourtCase, loadPair, pairBounds, sessionView } from '@/lib/bunny-court'

export const runtime = 'edge'

async function requireUser(request, candidate) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const verified = await verifyToken(token)
  return verified?.id === candidate ? verified : null
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const previewCaseId = searchParams.get('previewCaseId')
    if (!userId || !await requireUser(request, userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = courtServiceClient()
    const pair = await loadPair(supabase, userId)
    const { data: profile } = await supabase.from('profiles').select('subscription_tier').eq('id', userId).maybeSingle()
    const isPlus = (profile?.subscription_tier || 'free') !== 'free'
    if (previewCaseId) {
      if (!pair) return NextResponse.json({ error: 'not_paired' }, { status: 409 })
      const content = await loadCourtCase(supabase, previewCaseId)
      if (!content) return NextResponse.json({ error: 'case_not_found' }, { status: 404 })
      const definition = content.definition
      if (definition.category === 'Love Court' && !LOVE_RELATIONSHIPS.has(pair.relationship)) {
        return NextResponse.json({ error: 'relationship_not_eligible' }, { status: 403 })
      }
      if (definition.access_tier === 'plus' && !isPlus) {
        return NextResponse.json({ error: 'plus_required' }, { status: 403 })
      }
      return NextResponse.json({
        success: true,
        questions: (content.questions || []).map((question) => ({
          number: question.question_number,
          prompt: question.prompt,
          responseType: question.response_type,
          options: question.options,
          required: question.required,
        })),
      })
    }
    if (!pair) return NextResponse.json({ success: true, paired: false, isPlus, cases: [], active: null, history: [] })
    const [pairLow, pairHigh] = pairBounds(userId, pair.partner_user_id)
    const [{ data: definitions, error }, { data: activeRow }, { data: historyRows }] = await Promise.all([
      supabase.from('court_case_definitions').select('case_id,category,title,card_subtitle,eligibility,engine,access_tier,question_count,sensitivity').ilike('status', '%Launch').order('access_tier').order('case_id'),
      supabase.from('court_sessions').select('*').eq('pair_low', pairLow).eq('pair_high', pairHigh).in('status', ['awaiting_initiator','awaiting_partner','processing','ready']).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('court_sessions').select('id,case_id,status,completed_at,verdict_ready_at,created_at').eq('pair_low', pairLow).eq('pair_high', pairHigh).in('status', ['completed','ready']).order('updated_at', { ascending: false }).limit(20),
    ])
    if (error) throw error
    const active = activeRow ? await sessionView(supabase, activeRow, userId) : null
    const cases = await Promise.all((definitions || []).map(async (definition) => {
      const relationshipBlocked = definition.category === 'Love Court' && !LOVE_RELATIONSHIPS.has(pair.relationship)
      const plusBlocked = definition.access_tier === 'plus' && !isPlus
      return {
        id: definition.case_id, category: definition.category, title: definition.title,
        subtitle: definition.card_subtitle, engine: definition.engine, accessTier: definition.access_tier,
        questionCount: definition.question_count,
        sensitivity: definition.sensitivity,
        lockedReason: relationshipBlocked ? 'relationship' : plusBlocked ? 'plus' : null,
      }
    }))
    return NextResponse.json({ success: true, paired: true, isPlus, relationship: pair.relationship,
      partnerUserId: pair.partner_user_id, cases, active, history: historyRows || [] })
  } catch (error) {
    console.error('[court] catalog failed:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const body = await request.json()
    const userId = body?.userId
    if (!userId || !await requireUser(request, userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const caseId = typeof body?.caseId === 'string' ? body.caseId : ''
    if (!caseId) return NextResponse.json({ error: 'case_required' }, { status: 400 })
    const supabase = courtServiceClient()
    const pair = await loadPair(supabase, userId)
    if (!pair) return NextResponse.json({ error: 'not_paired' }, { status: 409 })
    const [pairLow, pairHigh] = pairBounds(userId, pair.partner_user_id)
    await supabase.from('court_sessions').update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('pair_low', pairLow).eq('pair_high', pairHigh)
      .in('status', EXPIRABLE_STATUSES)
      .lt('expires_at', new Date().toISOString())
    const [{ data: definition }, { data: profile }] = await Promise.all([
      supabase.from('court_case_definitions').select('*').eq('case_id', caseId).ilike('status', '%Launch').maybeSingle(),
      supabase.from('profiles').select('subscription_tier').eq('id', userId).maybeSingle(),
    ])
    if (!definition) return NextResponse.json({ error: 'case_not_found' }, { status: 404 })
    if (definition.category === 'Love Court' && !LOVE_RELATIONSHIPS.has(pair.relationship)) return NextResponse.json({ error: 'relationship_not_eligible' }, { status: 403 })
    const isPlus = (profile?.subscription_tier || 'free') !== 'free'
    if (definition.access_tier === 'plus' && !isPlus) return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    const content = await loadCourtCase(supabase, caseId)
    if (!content) return NextResponse.json({ error: 'content_missing' }, { status: 500 })
    const { data: created, error } = await supabase.from('court_sessions').insert({
      pair_low: pairLow, pair_high: pairHigh, initiator_id: userId, partner_id: pair.partner_user_id,
      case_id: caseId, content_version: definition.content_version, access_tier_snapshot: definition.access_tier,
      content_snapshot: content,
    }).select('*').single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'active_case_exists' }, { status: 409 })
      throw error
    }
    return NextResponse.json({
      success: true,
      session: await sessionView(supabase, created, userId),
      questions: (content.questions || []).map((question) => ({
        number: question.question_number,
        prompt: question.prompt,
        responseType: question.response_type,
        options: question.options,
        required: question.required,
      })),
    })
  } catch (error) {
    console.error('[court] create failed:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
