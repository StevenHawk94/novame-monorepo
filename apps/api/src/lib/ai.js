/**
 * lib/ai.js — Shared AI invocation layer with Gemini -> DeepSeek fallback
 *
 * Tier 1: gemini-2.5-flash           (primary)
 * Tier 2: deepseek-chat (V3.2)       (external fallback if Gemini fails)
 *
 * Per-call timeout: 5s (fits within Vercel edge 25s limit).
 *
 * All Gemini calls use system_instruction separation to maximize implicit cache hits.
 * Safety filters set to BLOCK_NONE so user diary content (emotions, stress, anger) is never blocked.
 */

const GEMINI_API_KEY = () => process.env.GEMINI_API_KEY
const DEEPSEEK_API_KEY = () => process.env.DEEPSEEK_API_KEY

const GEMINI_MODELS = [
  'gemini-2.5-flash',
]

const SAFETY_NONE = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
]


/**
 * fetch wrapper with hard timeout via AbortController.
 * Default 8s — fits within Vercel 25s limit when chained across 3 model tiers.
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
async function callGemini(model, { systemInstruction, userText, generationConfig, contents }) {
  const apiKey = GEMINI_API_KEY()
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  // Strip response_mime_type to avoid 400 errors on Gemini 2.5 models with system_instruction
  const { response_mime_type, ...safeGenConfig } = generationConfig || {}

  const body = {
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 5000,
      ...safeGenConfig,
    },
    safetySettings: SAFETY_NONE,
  }

  // Use system_instruction field (separate from contents) for implicit caching
  if (systemInstruction) {
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
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Gemini ${model} HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) throw new Error(`Gemini ${model} returned empty response`)

  return { text, model, provider: 'gemini', usage: data.usageMetadata }
}

/**
 * Call DeepSeek (OpenAI-compatible API).
 */
async function callDeepSeek({ systemInstruction, userText, generationConfig }) {
  const apiKey = DEEPSEEK_API_KEY()
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured')

  const messages = []
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction })
  if (userText) messages.push({ role: 'user', content: userText })

  const res = await fetchWithTimeout('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: generationConfig?.temperature ?? 0.7,
      max_tokens: generationConfig?.maxOutputTokens ?? 5000,
      response_format: generationConfig?.response_mime_type === 'application/json'
        ? { type: 'json_object' }
        : undefined,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`DeepSeek HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('DeepSeek returned empty response')

  return { text, model: 'deepseek-chat', provider: 'deepseek', usage: data.usage }
}

/**
 * Main entry point: try Gemini models in order, then DeepSeek.
 *
 * @param {Object} opts
 * @param {string} opts.systemInstruction  — fixed system prompt (cached by Gemini)
 * @param {string} opts.userText           — per-request user input
 * @param {Array}  opts.contents           — raw contents array (for multimodal; overrides userText)
 * @param {Object} opts.generationConfig   — { temperature, maxOutputTokens, response_mime_type }
 * @param {boolean} opts.skipDeepSeek      — true for multimodal requests (DeepSeek can't do audio)
 * @returns {{ text, model, provider, usage }}
 */
export async function callAI(opts) {
  const errors = []

  // Tier 1 & 2: Gemini models
  for (const model of GEMINI_MODELS) {
    try {
      const result = await callGemini(model, opts)
      return result
    } catch (err) {
      console.warn(`[AI] ${model} failed:`, err.message)
      errors.push(`${model}: ${err.message}`)
    }
  }

  // Tier 3: DeepSeek (text-only; skip for multimodal like audio transcription)
  if (!opts.skipDeepSeek && !opts.contents) {
    try {
      const result = await callDeepSeek(opts)
      return result
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
