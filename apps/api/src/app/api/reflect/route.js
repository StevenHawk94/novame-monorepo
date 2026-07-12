import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { promptDimension, DIMENSION_IDS } from '@novame/domain'
import { gemsForReflect, GEMS_PER_DIMENSION, matchItems, ITEM_DICTIONARY, findDuplicateSkill } from '@novame/engine'
import { callAI, parseAIJson } from '@/lib/ai'

export const runtime = 'edge'

const MAX_BODY_CHARS = 5000

const DIMENSION_SYSTEM_PROMPT = `You classify a personal journal entry into growth dimensions.

The eight dimensions (topics, not emotions):
- expression: speaking up, sharing something usually kept private
- awareness: noticing a pattern, self-insight, understanding why
- momentum: starting, doing, taking action, follow-through
- direction: clarity on what one wants, goals, what matters
- steadiness: handling a setback, staying grounded through difficulty
- confidence: trusting oneself, acting despite uncertainty
- gratitude: appreciating a moment, contentment
- connection: another person, empathy, relationships

Return ONLY a JSON array of 0 to 2 dimension ids the entry most strongly reflects, most relevant first. No prose, no markdown. Example: ["awareness","connection"]. If nothing clearly fits, return [].`

/**
 * AI dimension analysis (paid only). Returns up to two dimension ids from the
 * body, excluding the one the prompt already credits so the two AI slots add
 * breadth rather than repeat. Any failure -- model down, bad JSON -- degrades
 * to [], leaving the user with just the prompt dimension. The economy never
 * blocks on the AI.
 */
async function analyzeDimensions(body, excludeDim) {
  try {
    const raw = await callAI({
      systemInstruction: DIMENSION_SYSTEM_PROMPT,
      userText: body,
      generationConfig: { temperature: 0.3, maxOutputTokens: 50 },
    })
    const parsed = parseAIJson(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((d) => DIMENSION_IDS.includes(d) && d !== excludeDim))].slice(0, 2)
  } catch (err) {
    console.warn('[reflect] dimension analysis failed, degrading to prompt-only:', err && err.message)
    return []
  }
}

// Skill generation: whether this reflection holds a durable lesson worth
// keeping as a card. This is a FIRST-DRAFT prompt -- the content judgment (what
// counts as a real lesson, the voice) will be tuned; the JSON contract is what
// the code depends on. Not every reflect yields a skill: a play-by-play of a
// day has no lesson, and the model should say so via a low confidence.
const SKILL_SYSTEM_PROMPT = `You read a personal journal entry and extract a small lesson or insight from it -- something positive or meaningful the writer could carry forward.

[TEST PHASE: be generous. If the entry contains anything positive, any small realization, effort, feeling, or meaningful moment, generate a lesson from it. Only decline for an entry that is purely empty, gibberish, or has no content at all.]

Phrase the lesson as an insight in the writer's own register -- warm, specific to what they wrote, not a generic platitude.

Return ONLY a JSON object, no prose, no markdown:
{
  "hasSkill": boolean,        // true whenever there's anything to draw a lesson from
  "confidence": number,       // 0.0 to 1.0
  "title": string,            // <= 6 words, the lesson as a memorable handle
  "body": string,             // one sentence, the lesson
  "dimension": string         // one of: expression, awareness, momentum, direction, steadiness, confidence, gratitude, connection
}

Only return hasSkill false for truly empty or meaningless input.`

// Confidence gate. LOW for the test phase so skills generate easily and the
// flow is visible; tightens (and moves to app_config, tunable without a
// release) before launch.
const SKILL_CONFIDENCE_THRESHOLD = 0.3
const SECRET_SKILL_CHANCE = 0.1

/**
 * Generate a skill from the reflection, if it holds one. Paid+consented only
 * (skill count is a paid signal; free users never generate). Returns the skill
 * object to persist, or null -- on low confidence, no-skill, or any AI failure.
 * Dedup happens in the caller, against the user's existing skills.
 */
async function generateSkill(body, promptDim) {
  try {
    const raw = await callAI({
      systemInstruction: SKILL_SYSTEM_PROMPT,
      userText: body,
      generationConfig: { temperature: 0.4, maxOutputTokens: 200, response_mime_type: 'application/json' },
    })
    const parsed = parseAIJson(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.hasSkill || typeof parsed.confidence !== 'number') return null
    if (parsed.confidence < SKILL_CONFIDENCE_THRESHOLD) return null
    if (!parsed.title || !parsed.body) return null

    const dim = DIMENSION_IDS.includes(parsed.dimension) ? parsed.dimension : promptDim
    return {
      title: String(parsed.title).slice(0, 80),
      body: String(parsed.body).slice(0, 300),
      dimension: dim,
      rarity: Math.random() < SECRET_SKILL_CHANCE ? 'secret' : 'normal',
    }
  } catch (err) {
    console.warn('[reflect] skill generation failed (non-fatal):', err && err.message)
    return null
  }
}

/** ISO week like 2026-W28, from a YYYY-MM-DD date string. */
function isoWeek(dateStr) {
  const parts = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * POST /api/reflect
 *
 * Body: { userId, promptId (1-9), body (<=5000 chars), localDate (YYYY-MM-DD) }
 *
 * Computes XP and gem dimensions with the engine -- prompt dimension always,
 * plus AI analysis for paid+consented users -- then hands the numbers to the
 * submit_reflect RPC, which writes all five tables atomically under a lock and
 * returns a complete state snapshot. The client adopts that snapshot as-is;
 * this endpoint is the only place the numbers are decided (server authority).
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, promptId, body, localDate, presetDimension, sourceKit } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!Number.isInteger(promptId) || promptId < 1 || promptId > 9) {
      return NextResponse.json({ error: 'Invalid promptId' }, { status: 400 })
    }
    if (typeof body !== 'string' || body.length === 0) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 })
    }
    if (body.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Body too long' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('subscription_tier, ai_consent_at')
      .eq('id', userId)
      .single()
    if (pErr || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    const isPaid = (profile.subscription_tier || 'free') !== 'free'
    const hasConsent = !!profile.ai_consent_at

    // A reflect routed in from New Lens carries an explicit dimension (the
    // theme's) via presetDimension, overriding the prompt's own -- the user is
    // on the free-form prompt (9) but the reflection belongs to that theme.
    const pDim =
      presetDimension && DIMENSION_IDS.includes(presetDimension)
        ? presetDimension
        : promptDimension(promptId)
    let aiDimensions = []
    if (isPaid && hasConsent) {
      aiDimensions = await analyzeDimensions(body, pDim)
    }

    const gems = gemsForReflect({
      charCount: body.length,
      promptDimension: pDim,
      aiDimensions,
      isPaid,
    })
    const dimensionHits = gems.credited.map((d) => ({ dimension: d, gems: GEMS_PER_DIMENSION }))

    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const weekStr = isoWeek(dateStr)

    // XP is a flat 30. The RPC's daily gate (not this endpoint) enforces 3/day,
    // so a successful submit is always one of the first three and pays 30.
    const { data: result, error: rpcErr } = await supabase.rpc('submit_reflect', {
      p_user_id: userId,
      p_prompt_id: promptId,
      p_body: body,
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: 30,
      p_dimension_hits: dimensionHits,
      p_source_kit: sourceKit === 'new_lens' ? 'new_lens' : null,
    })
    if (rpcErr) {
      console.error('[reflect] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }

    // Item matching (C8): scan the reflection for known items and record them.
    // Additive and best-effort -- a failure here never affects the reflect,
    // which already succeeded above. Runs only on a real reflect (has an id).
    let matchedItems = []
    const reflectId = result?.reflect_id
    if (reflectId) {
      try {
        const matches = matchItems(body, ITEM_DICTIONARY)
        if (matches.length > 0) {
          await supabase.rpc('record_item_matches', {
            p_user_id: userId,
            p_reflect_id: reflectId,
            p_matches: matches.map((m) => ({ item_id: m.itemId, label: m.label })),
            p_local_date: dateStr,
          })
          matchedItems = matches.map((m) => ({
            itemId: m.itemId,
            displayName: m.displayName,
            rarity: m.rarity,
            label: m.label,
          }))
        }
      } catch (itemErr) {
        console.warn('[reflect] item matching failed (non-fatal):', itemErr && itemErr.message)
      }
    }

    // Skill generation (C9): paid + consented only (skill count is a paid
    // signal; free users never generate). Best-effort -- never blocks the
    // reflect. Generate a candidate, dedup against existing skills with the
    // engine's keyword overlap, and persist only if novel.
    let generatedSkill = null
    if (reflectId && isPaid && hasConsent) {
      try {
        const candidate = await generateSkill(body, pDim)
        if (candidate) {
          const { data: existing } = await supabase
            .from('skills')
            .select('title, body')
            .eq('user_id', userId)
          const existingTexts = (existing || []).map((sk) => ({
            text: `${sk.title} ${sk.body}`,
          }))
          const dup = findDuplicateSkill(`${candidate.title} ${candidate.body}`, existingTexts)
          if (!dup) {
            const { data: skillRes } = await supabase.rpc('record_skill', {
              p_user_id: userId,
              p_reflect_id: reflectId,
              p_dimension: candidate.dimension,
              p_title: candidate.title,
              p_body: candidate.body,
              p_rarity: candidate.rarity,
            })
            if (skillRes && !skillRes.error) {
              generatedSkill = {
                skillId: skillRes.skill_id,
                title: candidate.title,
                body: candidate.body,
                dimension: candidate.dimension,
                rarity: candidate.rarity,
              }
            }
          }
        }
      } catch (skillErr) {
        console.warn('[reflect] skill flow failed (non-fatal):', skillErr && skillErr.message)
      }
    }

    return NextResponse.json({ success: true, ...result, matchedItems, generatedSkill })
  } catch (err) {
    console.error('[reflect] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
