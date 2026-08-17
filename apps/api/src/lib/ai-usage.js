export async function recordAIUsage(supabase, {
  userId, feature, promptVersion, result = null, latencyMs = null,
  success = true, refId = null, error = null,
}) {
  try {
    await supabase.from('ai_usage_events').insert({
      user_id: userId || null,
      feature,
      prompt_version: promptVersion,
      provider: result?.provider || null,
      model: result?.model || null,
      usage: result?.usage || null,
      latency_ms: latencyMs == null ? null : Math.round(latencyMs),
      success,
      ref_id: refId == null ? null : String(refId),
      error: error ? String(error).slice(0, 500) : null,
    })
  } catch (err) {
    console.warn('[ai-usage] insert failed:', err && err.message)
  }
}

