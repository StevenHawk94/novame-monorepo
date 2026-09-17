import { after, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { drainPushNotificationOutbox } from '@/lib/push-notifications'
import {
  courtServiceClient, enqueueCourtNotification,
  loadCourtSessionContent, loadPair, processCourtVerdictJob,
  sessionView, validateCourtAnswers,
} from '@/lib/bunny-court'

export const runtime = 'edge'
export const maxDuration = 60

async function authorized(request, userId) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const verified = await verifyToken(token)
  return verified?.id === userId
}

async function sessionFor(supabase, sessionId, userId) {
  const { data, error } = await supabase.from('court_sessions').select('*').eq('id', sessionId).maybeSingle()
  if (error) throw error
  return data && [data.initiator_id, data.partner_id].includes(userId) ? data : null
}

export async function GET(request, context) {
  try {
    const { sessionId } = await context.params
    const userId = new URL(request.url).searchParams.get('userId')
    if (!userId || !await authorized(request, userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = courtServiceClient()
    const session = await sessionFor(supabase, sessionId, userId)
    if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (session.status === 'processing') {
      // Keep the poll fast while still helping a stranded persistent job make
      // progress. The cron route remains the final recovery path.
      after(() => processCourtVerdictJob(supabase, session.id).catch((error) => {
        console.warn('[court/session] verdict recovery deferred:', error?.message || error)
      }))
    }
    const view = await sessionView(supabase, session, userId)
    const content = await loadCourtSessionContent(supabase, session)
    const questions = content?.questions || []
    return NextResponse.json({
      success: true, session: view,
      questions: view?.hasSubmitted ? [] : questions.map((question) => ({
        number: question.question_number,
        prompt: view?.role === 'partner' && question.other_player_prompt
          && !/^same question/i.test(question.other_player_prompt)
          ? question.other_player_prompt : question.prompt,
        responseType: question.response_type, options: question.options, required: question.required,
      })),
    })
  } catch (error) {
    console.error('[court/session] get failed:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request, context) {
  try {
    const { sessionId } = await context.params
    const body = await request.json()
    const userId = body?.userId
    if (!userId || !await authorized(request, userId)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const supabase = courtServiceClient()
    let session = await sessionFor(supabase, sessionId, userId)
    if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const action = body?.action || 'submit'
    if (action === 'decline') {
      if (userId !== session.partner_id || session.status !== 'awaiting_partner') {
        return NextResponse.json({ error: 'decline_not_allowed' }, { status: 409 })
      }
      const now = new Date().toISOString()
      const { error } = await supabase.from('court_sessions').update({ status: 'declined', declined_by: userId, updated_at: now })
        .eq('id', session.id).eq('status', 'awaiting_partner')
      if (error) throw error
      return NextResponse.json({ success: true })
    }
    if (action === 'nudge') {
      if (session.initiator_id !== userId || session.status !== 'awaiting_partner') return NextResponse.json({ error: 'nudge_not_allowed' }, { status: 409 })
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: recentNudge } = await supabase.from('notification_outbox').select('id')
        .eq('recipient_user_id', session.partner_id).like('event_key', `court:nudge:${session.id}:%`)
        .gte('created_at', since).limit(1).maybeSingle()
      if (recentNudge) return NextResponse.json({ error: 'already_nudged_today' }, { status: 409 })
      const { error } = await supabase.from('notification_outbox').insert({
        recipient_user_id: session.partner_id, event_key: `court:nudge:${session.id}:${Date.now()}`,
        event_type: 'court_nudge',
        payload: { sessionId: session.id, title: 'Bunny Court is waiting.', body: 'Your person nudged the case. Add your testimony when you are ready.' },
      })
      if (error?.code === '23505') return NextResponse.json({ error: 'already_nudged_today' }, { status: 409 })
      if (error) throw error
      void drainPushNotificationOutbox(supabase, 10).catch(() => {})
      return NextResponse.json({ success: true })
    }
    if (action === 'complete') {
      if (!['ready', 'completed'].includes(session.status)) return NextResponse.json({ error: 'not_ready' }, { status: 409 })
      const now = new Date().toISOString()
      const { error } = await supabase.from('court_sessions').update({ status: 'completed', completed_at: now, updated_at: now })
        .eq('id', session.id).in('status', ['ready', 'completed'])
      if (error) throw error
      return NextResponse.json({ success: true })
    }
    if (!['awaiting_initiator', 'awaiting_partner'].includes(session.status)) {
      const { data: existingSubmission } = await supabase.from('court_submissions').select('session_id')
        .eq('session_id', session.id).eq('user_id', userId).maybeSingle()
      if (existingSubmission) {
        return NextResponse.json({ success: true, session: await sessionView(supabase, session, userId) })
      }
      return NextResponse.json({ error: 'case_not_accepting_answers' }, { status: 409 })
    }
    if (session.status === 'awaiting_initiator' && userId !== session.initiator_id) return NextResponse.json({ error: 'initiator_first' }, { status: 409 })
    const content = await loadCourtSessionContent(supabase, session)
    if (!content) return NextResponse.json({ error: 'content_missing' }, { status: 500 })
    let answers
    try { answers = validateCourtAnswers(content.questions, body?.answers) }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }) }
    const submissionAnswers = { ...answers, __share_answers: body?.shareAnswers === true }
    const { error: submissionError } = await supabase.from('court_submissions').insert({
      session_id: session.id, user_id: userId, answers: submissionAnswers,
    })
    if (submissionError?.code !== '23505' && submissionError) throw submissionError
    const { data: submissions } = await supabase.from('court_submissions').select('user_id,answers').eq('session_id', session.id)
    if ((submissions || []).length < 2) {
      const now = new Date().toISOString()
      const { error } = await supabase.from('court_sessions').update({ status: 'awaiting_partner', updated_at: now }).eq('id', session.id).eq('status', 'awaiting_initiator')
      if (error) throw error
      await enqueueCourtNotification(supabase, session.partner_id, session.id, 'invite', {
        title: content.definition.notification_copy?.inviteTitle, body: content.definition.notification_copy?.inviteBody,
      })
    } else {
      const pair = await loadPair(supabase, userId)
      const expectedPartner = userId === session.initiator_id ? session.partner_id : session.initiator_id
      if (!pair || pair.partner_user_id !== expectedPartner) {
        await supabase.from('court_sessions').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', session.id)
        return NextResponse.json({ error: 'pairing_ended' }, { status: 409 })
      }
      const now = new Date().toISOString()
      const { data: transitioned, error: transitionError } = await supabase.from('court_sessions')
        .update({ status: 'processing', updated_at: now }).eq('id', session.id)
        .in('status', ['awaiting_initiator', 'awaiting_partner']).select('id').maybeSingle()
      if (transitionError) throw transitionError
      if (!transitioned) return NextResponse.json({ error: 'case_not_accepting_answers' }, { status: 409 })
      session = { ...session, status: 'processing' }
      const { error: jobError } = await supabase.from('court_verdict_jobs').upsert(
        { session_id: session.id }, { onConflict: 'session_id', ignoreDuplicates: true },
      )
      if (jobError) throw jobError
      // Both deterministic and AI verdicts run through the same durable job.
      // The sealed submission responds immediately; polling/cron recovers an
      // interrupted serverless invocation without holding either client open.
      after(() => processCourtVerdictJob(supabase, session.id).catch((error) => {
        console.warn('[court/session] verdict deferred:', error?.message || error)
      }))
    }
    session = await sessionFor(supabase, session.id, userId)
    return NextResponse.json({ success: true, session: await sessionView(supabase, session, userId) })
  } catch (error) {
    console.error('[court/session] post failed:', error?.message || error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
