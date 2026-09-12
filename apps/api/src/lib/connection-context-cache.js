const CACHE_KEY = 'connection-common'
const CACHE_MODEL = 'gemini-2.5-flash'
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000
const ERROR_RETRY_MS = 5 * 60 * 1000

const apiKey = () => process.env.GEMINI_API_KEY
const endpoint = (path) => `https://generativelanguage.googleapis.com/v1beta/${path}?key=${apiKey()}`

async function promptHash(value) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(value),
  )
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

async function saveReady(supabase, hash, remoteName, expiresAt) {
  const { error } = await supabase.from('ai_context_caches').update({
    model: CACHE_MODEL,
    prompt_hash: hash,
    remote_name: remoteName,
    expires_at: expiresAt,
    last_used_at: new Date().toISOString(),
    refresh_lease_until: null,
    status: 'ready',
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('cache_key', CACHE_KEY)
  if (error) throw error
}

async function saveFailure(supabase, error) {
  await supabase.from('ai_context_caches').update({
    status: 'error',
    last_error: String(error?.message || error).slice(0, 500),
    refresh_lease_until: new Date(Date.now() + ERROR_RETRY_MS).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('cache_key', CACHE_KEY)
}

async function createCache(systemInstruction, hash) {
  const res = await cacheFetch('cachedContents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${CACHE_MODEL}`,
      displayName: `${CACHE_KEY}-${hash.slice(0, 12)}`,
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
 * Resolve the single project-wide Connection cache. The database RPC owns a
 * short lease, so only one Vercel instance creates or renews it. Contending
 * requests safely run uncached instead of waiting on the lease holder.
 */
export async function getConnectionContextCache(supabase, systemInstruction) {
  if (!supabase || !apiKey() || !systemInstruction) return null
  const hash = await promptHash(systemInstruction)
  const renewBefore = new Date(Date.now() + RENEW_BEFORE_MS).toISOString()
  try {
    const { data, error } = await supabase.rpc('claim_ai_context_cache', {
      p_cache_key: CACHE_KEY,
      p_model: CACHE_MODEL,
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
        await saveReady(supabase, hash, renewed.remoteName, renewed.expiresAt)
        return renewed.remoteName
      } catch (error) {
        if (!error.cacheGone && Date.parse(claim.expires_at || '') > Date.now()) {
          await saveFailure(supabase, error)
          return claim.remote_name
        }
        // The registry was stale. The current request remains available via
        // the uncached path and the next request will claim a fresh creation.
        await saveFailure(supabase, error)
        return null
      }
    }

    if (claim.action === 'create') {
      const created = await createCache(systemInstruction, hash)
      await saveReady(supabase, hash, created.remoteName, created.expiresAt)
      return created.remoteName
    }
  } catch (error) {
    console.warn('[connection-cache] explicit cache unavailable:', error.message)
    await saveFailure(supabase, error).catch(() => {})
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
  }).eq('cache_key', CACHE_KEY).eq('remote_name', remoteName)
}

export const CONNECTION_CACHE_CONFIG = {
  key: CACHE_KEY,
  model: CACHE_MODEL,
  ttlSeconds: CACHE_TTL_SECONDS,
  renewBeforeMs: RENEW_BEFORE_MS,
  errorRetryMs: ERROR_RETRY_MS,
}
