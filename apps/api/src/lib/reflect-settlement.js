import { createMemoryCopy } from './reflect-draft'
import { recordAIUsage } from './ai-usage'
import { REFLECT_COPY_VERSION, isUsableReflectMemoryCopy } from './reflect-ai'

// An atomic, durable claim is shared by prepare and upgrade/enrich. A timeout,
// HTTP retry, concurrent client or fresh Metro process never repeats this AI call.
export async function generateSavedReflectCopy(supabase, draft, userId) {
  if (!draft.saved_reflect_id || draft.finalized_reflect_id) return draft
  const { data: claimed, error } = await supabase.from('reflect_drafts')
    .update({ ai_claimed_at: new Date().toISOString() })
    .eq('id', draft.id).eq('user_id', userId)
    .is('ai_claimed_at', null).is('finalized_reflect_id', null).select('id').maybeSingle()
  if (error) throw error
  if (claimed) {
    const edited = new Set((draft.settlement_memories || []).filter((m) => m.edited).map((m) => m.itemId))
    const targets = (draft.matches || []).filter((m) => !edited.has(m.itemId)
      && !isUsableReflectMemoryCopy(draft.ai_memories?.[m.itemId]))
    const generated = await createMemoryCopy({
      body: draft.body, matches: targets, generateBunny: draft.mode === 'typing' && !draft.bubble,
    })
    const { data: saved, error: saveError } = await supabase.rpc('store_reflect_generation', {
      p_user_id: userId, p_draft_id: draft.id, p_memories: generated.memories, p_bubble: generated.bubble,
    })
    // Fail closed: do not return generated words which have not been saved.
    if (saveError || saved?.error) throw saveError || new Error(saved.error)
    await recordAIUsage(supabase, {
      userId, feature: 'reflect_copy', promptVersion: REFLECT_COPY_VERSION, refId: draft.id,
      ...(generated.error ? { success: false, error: generated.error?.message || String(generated.error) }
        : { result: generated.usage?.result, latencyMs: generated.usage?.latencyMs }),
    })
  }
  const { data: latest, error: readError } = await supabase.from('reflect_drafts').select('*')
    .eq('id', draft.id).eq('user_id', userId).single()
  if (readError) throw readError
  return latest
}

export function sanitizeSettlementMemories(items) {
  return items.map((m) => ({
    itemId: typeof m?.itemId === 'string' ? m.itemId : '',
    text: typeof m?.text === 'string' ? m.text.slice(0, 500) : '',
    source: ['manual', 'ai', 'use_my_words'].includes(m?.source) ? m.source : 'manual',
    visible: m?.visible !== false,
    // Old clients don't send this flag; conservatively preserve their input.
    edited: m?.edited !== false,
  })).filter((m) => m.itemId)
}
