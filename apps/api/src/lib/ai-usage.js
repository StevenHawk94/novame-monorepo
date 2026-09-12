export async function recordAIUsage(supabase, {
  userId, feature, promptVersion, result = null, latencyMs = null,
  success = true, refId = null, error = null,
}) {
  try {
    const rawUsage = result?.usage && typeof result.usage === 'object' ? result.usage : null
    const cachedTokens = Number(
      rawUsage?.cachedContentTokenCount ?? rawUsage?.total_cached_tokens ?? 0,
    ) || 0
    const usage = rawUsage ? {
      ...rawUsage,
      finishReason: result?.finishReason || null,
      explicitCacheRequested: !!result?.cachedContent,
      explicitCacheHit: !!result?.cachedContent && cachedTokens > 0,
      cacheFallback: result?.cacheFallback === true,
    } : null
    const { error: insertError } = await supabase.from('ai_usage_events').insert({
      user_id: userId || null,
      feature,
      prompt_version: promptVersion,
      provider: result?.provider || null,
      model: result?.model || null,
      usage,
      latency_ms: latencyMs == null ? null : Math.round(latencyMs),
      success,
      ref_id: refId == null ? null : String(refId),
      error: error ? String(error).slice(0, 500) : null,
    })
    if (insertError) throw insertError
  } catch (err) {
    console.warn('[ai-usage] insert failed:', err && err.message)
  }
}
