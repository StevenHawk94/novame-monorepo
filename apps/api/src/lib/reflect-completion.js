import { serviceClient } from './reflect-draft'
import { runReflectAnalyzer, REFLECT_ANALYZER_VERSION } from './reflect-ai'
import { loadReflectAnalyzerContext, persistReflectAnalyzerResult } from './reflect-analysis-store'
import { recordAIUsage } from './ai-usage'

async function markConnectionRecoveryRequired(supabase, userId) {
  const { data: pairing } = await supabase.from('pairings')
    .select('partner_user_id').eq('user_id', userId).maybeSingle()
  if (!pairing?.partner_user_id) return
  await supabase.from('profiles')
    .update({ connection_resume_required: true })
    .eq('id', pairing.partner_user_id)
}

export async function analyzeFinalizedReflect({ userId, draft, result }) {
  const supabase = serviceClient()
  let context = {
    connectionEligible: false, connectionEnabled: false, currentBoard: null, pair: null,
  }
  try {
    const { data: profile } = await supabase.from('profiles')
      .select('subscription_tier, ai_consent_at').eq('id', userId).single()
    if ((profile?.subscription_tier || 'free') === 'free' || !profile?.ai_consent_at) return
    if (!draft.body?.trim()) return

    context = await loadReflectAnalyzerContext(supabase, {
      userId, visibleToFriend: result.shared_to_friends !== false, localDate: draft.local_date,
      excludeReflectIds: [result.reflect_id],
    })
    const analyzer = await runReflectAnalyzer({
      reflectId: result.reflect_id,
      journal: draft.body,
      matchedIcons: (draft.matches || []).map((item) => ({
        id: item.itemId, name: item.displayName, acceptedKeywords: item.matchedKeywords || [],
      })),
      // Extract eligible Connection signals even while the reader is inactive.
      // Persistence still keeps them inactive until the reader returns.
      connectionEnabled: context.connectionEligible,
      currentConnectionBoard: context.connectionEligible ? context.currentBoard : null,
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
