const LEGACY_CACHE_KEY = 'connection-common'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000
const ERROR_RETRY_MS = 5 * 60 * 1000
const AUTO_WINDOW_DAYS = 7
const AUTO_MIN_CALLS = 623
const GEMINI_EXPLICIT_CACHE_MIN_TOKENS = 2048
const DECISION_TTL_MS = 15 * 60 * 1000

const decisions = new Map()
const retired = new Set()
const apiKey = () => process.env.GEMINI_API_KEY
const endpoint = (path) => `https://generativelanguage.googleapis.com/v1beta/${path}?key=${apiKey()}`

async function promptHash(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function cacheFetch(path, options, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(endpoint(path), { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function retireCache(supabase, cacheKey) {
  if (!supabase || retired.has(cacheKey)) return
  try {
    const { data, error } = await supabase.from('ai_context_caches')
      .select('remote_name').eq('cache_key', cacheKey).maybeSingle()
    if (error) throw error
    if (data?.remote_name) {
      const response = await cacheFetch(data.remote_name, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) return
    }
    await supabase.from('ai_context_caches').update({
      remote_name: null,
      expires_at: null,
      refresh_lease_until: null,
      status: 'missing',
      last_error: 'explicit_cache_not_economical',
      updated_at: new Date().toISOString(),
    }).eq('cache_key', cacheKey)
    retired.add(cacheKey)
  } catch (error) {
    console.warn('[connection-cache] cache retirement failed:', error.message)
  }
}

async function shouldUseExplicitCache(supabase, cacheKey, features) {
  const mode = String(process.env.CONNECTION_EXPLICIT_CACHE_MODE || 'auto').toLowerCase()
  if (mode === 'off') return false
  if (mode === 'on') return true
  const cached = decisions.get(cacheKey)
  if (cached && Date.now() - cached.checkedAt < DECISION_TTL_MS) return cached.enabled
  const since = new Date(Date.now() - AUTO_WINDOW_DAYS * 86400000).toISOString()
  const query = supabase.from('ai_usage_events').select('id', { count: 'exact', head: true })
    .eq('provider', 'gemini').gte('created_at', since)
  const { count, error } = features?.length ? await query.in('feature', features) : await query
  if (error) throw error
  const enabled = Number(count || 0) >= AUTO_MIN_CALLS
  decisions.set(cacheKey, { checkedAt: Date.now(), enabled })
  return enabled
}

async function saveReady(supabase, cacheKey, model, hash, remoteName, expiresAt) {
  const { error } = await supabase.from('ai_context_caches').update({
    model,
    prompt_hash: hash,
    remote_name: remoteName,
    expires_at: expiresAt,
    last_used_at: new Date().toISOString(),
    refresh_lease_until: null,
    status: 'ready',
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('cache_key', cacheKey)
  if (error) throw error
}

async function saveFailure(supabase, cacheKey, error) {
  await supabase.from('ai_context_caches').update({
    status: 'error',
    last_error: String(error?.message || error).slice(0, 500),
    refresh_lease_until: new Date(Date.now() + ERROR_RETRY_MS).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('cache_key', cacheKey)
}

async function createCache(cacheKey, model, systemInstruction, hash) {
  const res = await cacheFetch('cachedContents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${model}`,
      displayName: `${cacheKey}-${hash.slice(0, 12)}`,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      ttl: `${CACHE_TTL_SECONDS}s`,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini cache create HTTP ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  if (!data?.name || !data?.expireTime) throw new Error('Gemini cache create returned incomplete metadata')
  return { remoteName: data.name, expiresAt: data.expireTime }
}

async function renewCache(remoteName) {
  const res = await cacheFetch(remoteName, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: `${CACHE_TTL_SECONDS}s` }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const error = new Error(`Gemini cache renew HTTP ${res.status}: ${detail.slice(0, 200)}`)
    error.cacheGone = [400, 403, 404].includes(res.status)
    throw error
  }
  const data = await res.json()
  if (!data?.name || !data?.expireTime) throw new Error('Gemini cache renew returned incomplete metadata')
  return { remoteName: data.name, expiresAt: data.expireTime }
}

/**
 * Explicit caching is used only when its prompt reaches Gemini's minimum and
 * the rolling seven-day call volume is high enough to beat storage cost.
 */
export async function getConnectionContextCache(supabase, systemInstruction, {
  cacheKey = 'connection-writer', model = 'gemini-2.5-flash', features = [],
} = {}) {
  if (!supabase || !apiKey() || !systemInstruction) return null
  await retireCache(supabase, LEGACY_CACHE_KEY)
  const estimatedTokens = Math.ceil(systemInstruction.length / 4)
  if (estimatedTokens < GEMINI_EXPLICIT_CACHE_MIN_TOKENS
    || !(await shouldUseExplicitCache(supabase, cacheKey, features))) {
    await retireCache(supabase, cacheKey)
    return null
  }
  const hash = await promptHash(systemInstruction)
  const renewBefore = new Date(Date.now() + RENEW_BEFORE_MS).toISOString()
  try {
    const { data, error } = await supabase.rpc('claim_ai_context_cache', {
      p_cache_key: cacheKey,
      p_model: model,
      p_prompt_hash: hash,
      p_renew_before: renewBefore,
    })
    if (error) throw error
    const claim = Array.isArray(data) ? data[0] : data
    if (!claim || claim.action === 'wait') return null
    if (claim.action === 'reuse') return claim.remote_name || null
    if (claim.action === 'renew' && claim.remote_name) {
      try {
        const renewed = await renewCache(claim.remote_name)
        await saveReady(supabase, cacheKey, model, hash, renewed.remoteName, renewed.expiresAt)
        return renewed.remoteName
      } catch (error) {
        await saveFailure(supabase, cacheKey, error)
        return !error.cacheGone && Date.parse(claim.expires_at || '') > Date.now()
          ? claim.remote_name : null
      }
    }
    if (claim.action === 'create') {
      const created = await createCache(cacheKey, model, systemInstruction, hash)
      await saveReady(supabase, cacheKey, model, hash, created.remoteName, created.expiresAt)
      return created.remoteName
    }
  } catch (error) {
    console.warn('[connection-cache] explicit cache unavailable:', error.message)
    await saveFailure(supabase, cacheKey, error).catch(() => {})
  }
  return null
}

export async function invalidateConnectionContextCache(supabase, remoteName, error = null) {
  if (!supabase || !remoteName) return
  await supabase.from('ai_context_caches').update({
    remote_name: null,
    expires_at: null,
    refresh_lease_until: null,
    status: 'missing',
    last_error: error ? String(error).slice(0, 500) : 'remote_cache_rejected',
    updated_at: new Date().toISOString(),
  }).eq('remote_name', remoteName)
}

export const CONNECTION_CACHE_CONFIG = {
  ttlSeconds: CACHE_TTL_SECONDS,
  renewBeforeMs: RENEW_BEFORE_MS,
  errorRetryMs: ERROR_RETRY_MS,
  autoWindowDays: AUTO_WINDOW_DAYS,
  autoMinCalls: AUTO_MIN_CALLS,
  explicitMinTokens: GEMINI_EXPLICIT_CACHE_MIN_TOKENS,
}
