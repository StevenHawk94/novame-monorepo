/**
 * lib/ai.js — Shared AI invocation layer with Gemini -> DeepSeek fallback
 *
 * Tier 1: AI_MODEL_DEFAULT           (Gemini primary)
 * Tier 2: AI_MODEL_FALLBACK          (DeepSeek fallback if Gemini fails)
 *
 * Default per-provider timeout is 15s. Callers with a longer background job
 * can provide one totalTimeoutMs budget shared by primary and fallback.
 *
 * Gemini calls support both system_instruction separation and explicit cached content.
 * Safety filters set to BLOCK_NONE so user diary content (emotions, stress, anger) is never blocked.
 */

const GEMINI_API_KEY = () => process.env.GEMINI_API_KEY
const DEEPSEEK_API_KEY = () => process.env.DEEPSEEK_API_KEY

/**
 * Server-owned model routing. Environment overrides make model retirement an
 * API deployment/configuration change; no mobile release is required.
 */
export function getAIModelConfig() {
  const defaultGemini = process.env.AI_MODEL_DEFAULT?.trim() || 'gemini-2.5-flash'
  return {
    defaultGemini,
    connectionRouter: process.env.AI_MODEL_CONNECTION_ROUTER?.trim()
      || 'gemini-2.5-flash-lite',
    connectionWriter: process.env.AI_MODEL_CONNECTION_WRITER?.trim()
      || defaultGemini,
    fallback: process.env.AI_MODEL_FALLBACK?.trim() || 'deepseek-chat',
  }
}

const SAFETY_NONE = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
]


/**
 * fetch wrapper with hard timeout via AbortController.
 * Default 15s. A caller-level deadline may supply a smaller remaining budget.
 */
async function fetchWithTimeout(url, options, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Call Gemini with system_instruction + user content.
 * Splitting system_instruction from contents maximizes implicit cache hits
 * (the system part stays constant, Gemini auto-caches the prefix).
 */
async function callGemini(model, {
  systemInstruction, userText, generationConfig, contents, requestTimeoutMs, cachedContent,
}) {
  const apiKey = GEMINI_API_KEY()
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  // Gemini supports JSON mode and response schemas alongside system_instruction.
  // Accept the legacy snake_case option used by older callers, but send the
  // REST API's camelCase fields on the wire.
  const {
    response_mime_type,
    response_schema,
    responseMimeType,
    responseSchema,
    ...safeGenConfig
  } = generationConfig || {}

  const body = {
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 5000,
      ...safeGenConfig,
      ...((responseMimeType || response_mime_type) ? {
        responseMimeType: responseMimeType || response_mime_type,
      } : {}),
      ...((responseSchema || response_schema) ? {
        responseSchema: responseSchema || response_schema,
      } : {}),
    },
    safetySettings: SAFETY_NONE,
  }

  // Explicit cached content already contains the shared system instruction.
  // Gemini does not accept a second system instruction alongside it.
  if (cachedContent) {
    body.cachedContent = cachedContent
  } else if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] }
  }

  // Support either raw text or pre-built contents array (for multimodal like audio)
  if (contents) {
    body.contents = contents
  } else if (userText) {
    body.contents = [{ parts: [{ text: userText }] }]
  }

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    requestTimeoutMs,
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    const error = new Error(`Gemini ${model} HTTP ${res.status}: ${errText.slice(0, 200)}`)
    error.status = res.status
    error.cachedContentRejected = !!cachedContent && [400, 403, 404].includes(res.status)
    throw error
  }

  const data = await res.json()
  const candidate = data.candidates?.[0]
  const finishReason = candidate?.finishReason || null
  const text = candidate?.content?.parts?.[0]?.text?.trim() || ''
  // A MAX_TOKENS response can legitimately contain no parseable text. Return
  // its metadata so the caller can retry with a larger, bounded output budget.
  if (!text && finishReason !== 'MAX_TOKENS') {
    throw new Error(`Gemini ${model} returned empty response`)
  }

  return {
    text,
    model,
    provider: 'gemini',
    usage: data.usageMetadata,
    finishReason,
    cachedContent: cachedContent || null,
  }
}

/**
 * Call DeepSeek (OpenAI-compatible API).
 */
async function callDeepSeek({ systemInstruction, userText, generationConfig, requestTimeoutMs }, model) {
  const apiKey = DEEPSEEK_API_KEY()
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured')

  const messages = []
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction })
  if (userText) messages.push({ role: 'user', content: userText })

  const res = await fetchWithTimeout('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: generationConfig?.temperature ?? 0.7,
      max_tokens: generationConfig?.maxOutputTokens ?? 5000,
      response_format: (generationConfig?.responseMimeType
        || generationConfig?.response_mime_type) === 'application/json'
        ? { type: 'json_object' }
        : undefined,
    }),
  }, requestTimeoutMs)

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`DeepSeek HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('DeepSeek returned empty response')

  return { text, model, provider: 'deepseek', usage: data.usage }
}

/**
 * Main entry point: try Gemini models in order, then DeepSeek.
 *
 * @param {Object} opts
 * @param {string} opts.systemInstruction  — fixed system prompt (cached by Gemini)
 * @param {string} opts.userText           — per-request user input
 * @param {Array}  opts.contents           — raw contents array (for multimodal; overrides userText)
 * @param {Object} opts.generationConfig   — generation controls, including optional JSON schema
 * @param {boolean} opts.skipDeepSeek      — true for multimodal requests (DeepSeek can't do audio)
 * @param {number} opts.totalTimeoutMs     — optional total budget shared by all provider attempts
 * @param {string} opts.cachedContent      — Gemini explicit cachedContents resource name
 * @param {string} opts.geminiModel        — optional primary Gemini model override
 * @returns {{ text, model, provider, usage }}
 */
export async function callAI(opts) {
  const configuredModels = getAIModelConfig()
  const errors = []
  const providerAttempts = []
  let cacheFallback = false
  const totalTimeoutMs = Number.isFinite(opts.totalTimeoutMs) && opts.totalTimeoutMs > 0
    ? opts.totalTimeoutMs : null
  const deadline = totalTimeoutMs ? Date.now() + totalTimeoutMs : null
  const withRemainingTimeout = () => {
    if (!deadline) return opts
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`AI request budget exhausted after ${totalTimeoutMs}ms`)
    return { ...opts, requestTimeoutMs: remaining }
  }

  const geminiModels = typeof opts.geminiModel === 'string' && opts.geminiModel.trim()
    ? [opts.geminiModel.trim()]
    : [configuredModels.defaultGemini]

  // Gemini primary. Individual workloads may choose a cheaper model while
  // retaining the shared provider fallback and timeout behavior.
  for (const model of geminiModels) {
    try {
      const result = await callGemini(model, withRemainingTimeout())
      return result
    } catch (err) {
      console.warn(`[AI] ${model} failed:`, err.message)
      errors.push(`${model}: ${err.message}`)
      providerAttempts.push({
        provider: 'gemini', model, success: false,
        status: Number.isFinite(err.status) ? err.status : null,
        error: String(err.message || err).slice(0, 300),
      })
      // A stale/invalid cache must not turn a healthy Gemini request into a
      // provider fallback. Retry the same model once with the full system
      // instruction; the caller will invalidate the durable cache pointer.
      if (err.cachedContentRejected) {
        cacheFallback = true
        try {
          const result = await callGemini(model, {
            ...withRemainingTimeout(), cachedContent: null,
          })
          return { ...result, cacheFallback }
        } catch (retryError) {
          console.warn(`[AI] ${model} uncached retry failed:`, retryError.message)
          errors.push(`${model} uncached: ${retryError.message}`)
          providerAttempts.push({
            provider: 'gemini', model, success: false, uncachedRetry: true,
            status: Number.isFinite(retryError.status) ? retryError.status : null,
            error: String(retryError.message || retryError).slice(0, 300),
          })
        }
      }
    }
  }

  // Tier 2: DeepSeek (text-only; skip for multimodal like audio transcription)
  if (!opts.skipDeepSeek && !opts.contents) {
    try {
      const result = await callDeepSeek(withRemainingTimeout(), configuredModels.fallback)
      return {
        ...result,
        ...(cacheFallback ? { cacheFallback: true } : {}),
        ...(providerAttempts.length > 0 ? { providerAttempts } : {}),
      }
    } catch (err) {
      console.warn('[AI] DeepSeek failed:', err.message)
      errors.push(`deepseek: ${err.message}`)
    }
  }

  // Surface a user-friendly message; keep the technical chain in console
  console.error('[AI] All models failed:', errors.join(' | '))
  throw new Error('All AI models failed, please try again later.')
}

/**
 * Parse JSON from AI text output (handles markdown fences, trailing text, etc.)
 */
// Escape bare control chars that appear INSIDE JSON string literals.
// Models occasionally emit a real newline/tab inside a string value
// instead of the escaped \\n / \\t, which makes JSON.parse throw
// "Bad control character in string literal". We walk the text tracking
// whether we're inside a string and escape only those in-string control
// chars, leaving structural whitespace untouched.
function sanitizeJsonControlChars(s) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const code = s.charCodeAt(i)
    if (escaped) { out += ch; escaped = false; continue }
    if (ch === '\\') { out += ch; escaped = true; continue }
    if (ch === '"') { inString = !inString; out += ch; continue }
    if (inString && code < 0x20) {
      if (ch === '\n') out += '\\n'
      else if (ch === '\r') out += '\\r'
      else if (ch === '\t') out += '\\t'
      else out += '\\u' + code.toString(16).padStart(4, '0')
      continue
    }
    out += ch
  }
  return out
}

export function parseAIJson(rawText) {
  const cleaned = rawText
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    // Bare control chars in string values -> sanitize and retry once.
    return JSON.parse(sanitizeJsonControlChars(cleaned))
  }
}
