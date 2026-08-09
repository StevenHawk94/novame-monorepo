import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { rateLimit } from '@/lib/rate-limit'
import { getMergedDictionary } from '@/lib/remote-items'
import { createClient } from '@supabase/supabase-js'
import { promptDimension, DIMENSION_IDS } from '@novame/domain'
import { gemsForReflect, GEMS_PER_DIMENSION, matchItems, ITEM_DICTIONARY, matchSkillCards, XP_RULES } from '@novame/engine'
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
    const res = await callAI({
      systemInstruction: DIMENSION_SYSTEM_PROMPT,
      userText: body,
      generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
    })
    const parsed = parseAIJson(res.text)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((d) => DIMENSION_IDS.includes(d) && d !== excludeDim))].slice(0, 2)
  } catch (err) {
    console.warn('[reflect] dimension analysis failed, degrading to prompt-only:', err && err.message)
    return []
  }
}

// Companion bubble: a short, warm one-liner the pet "says" on Home after a
// reflection. First-draft placeholder prompt. Plain text (not JSON) -- one line.
async function generateBubble(body) {
  try {
    const res = await callAI({
      systemInstruction: BUBBLE_SYSTEM_PROMPT,
      userText: body,
      generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
    })
    const line = (res.text || '').trim().replace(/^["']|["']$/g, '')
    if (!line || line.length > 200) return null
    return line
  } catch (err) {
    console.warn('[reflect] bubble generation failed (non-fatal):', err && err.message)
    return null
  }
}

// Skill generation: whether this reflection holds a durable lesson worth
// keeping as a card. This is a FIRST-DRAFT prompt -- the content judgment (what
// counts as a real lesson, the voice) will be tuned; the JSON contract is what
// the code depends on. Not every reflect yields a skill: a play-by-play of a
// day has no lesson, and the model should say so via a low confidence.
const BUBBLE_SYSTEM_PROMPT = `You are the user's companion pet in a personal-growth app. They just finished writing a reflection. Respond with ONE warm, short line, under 25 words, the way their companion would -- caring and specific to what they wrote, like a friend checking in. No preamble. Return ONLY the line: no quotes, no JSON, no markdown.`

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

// Plus 回忆标题 (2026-08-09 final spec: Memory Items Title Generator).
// One call titles every un-edited item at once; user-edited items are never
// in the list. JSON only, keyed by item id.
const REFINE_SYSTEM_PROMPT = `You label "memory objects" pulled from a diary entry. You get the diary text and a list of matched items (id: name). For each item, write one short title that folds in the most specific context the entry attaches to THAT item's mention -- as if labeling a keepsake from that day. Do not re-extract or invent items.

Finding context -- scan around each item's mention for:
- who it's connected to (present, made it, gave it, shared it)
- what else was happening at the same time
- a stated quality or sensory detail
- an action, plan, or obligation tied to it
- a cause or reason behind it
- where/when, if that's the most distinctive detail
- the entry's overall mood -- ONLY as a last resort when nothing item-specific exists

How much to include: rank the distinct details you find for that item by specificity and use the top 1-2. One real detail beats padding in a second; three or more means pick the best 2. A detail unique to that item (a person, a simultaneous action, an origin) always beats a generic one that fits the whole entry (overall mood). Two items may share the same context when that's all the entry gives.

Title rules:
- No fixed template. Start with "The" + the item (or a natural reference like "Mom's ___"); let the grammar follow the content: adjective, "with ___", "while ___", "that ___", a clause about what happens next.
- Use the entry's own wording where possible; light cleanup ok; never invent people, events, or opinions.
- Roughly 4-10 words with one detail, up to 14 with two. Shorter and accurate beats longer and forced.
- Title Case; keep connectors (a, an, on, to, by, of, with, that, while) lowercase unless first.
- If the entry says nothing about an item at all, a simple "The <name>" plus the day's mood is fine.

Examples of range (not templates):
Entry: "Feeling anxious but had lunch on time -- the sandwich was actually pretty good, had coffee with it. That Breaking Bad episode is legit. A colleague says the PowerPoint needs to be finished by tomorrow."
-> sandwich: "The Sandwich That Was Actually Pretty Good"; coffee: "The Coffee on an Anxious Lunch"; netflix: "The Legit Breaking Bad Episode"; powerpoint: "The PowerPoint That Needs to be Done by Tomorrow"
Entry: "Mom made me a sandwich before I sat down to binge Breaking Bad -- honestly the best one in a while."
-> sandwich: "Mom's Sandwich Before Binging Breaking Bad" (3 details found; only the top 2 kept)

Return ONLY JSON: { "items": { "<itemId>": "<title>", ... } }, one entry per input item. No prose, no markdown, no reasoning.`

// Plus cute story (流程2, PLACEHOLDER copy): a tiny warm story of the day
// woven from the picked items, to share with the paired person.
const STORY_SYSTEM_PROMPT = `You write a tiny, cute story (3-5 sentences, max 90 words) about someone's day, woven from the items they picked and any note they left. Warm, playful, second person ("you"), no emoji spam (one or two is fine).

Also write one short caption per item (max 12 words) that matches the story.

Return ONLY JSON: { "story": "<the story>", "items": { "<itemId>": "<caption>", ... } }. No prose, no markdown.`

/**
 * Generate a skill from the reflection, if it holds one. Paid+consented only
 * (skill count is a paid signal; free users never generate). Returns the skill
 * object to persist, or null -- on low confidence, no-skill, or any AI failure.
 * Dedup happens in the caller, against the user's existing skills.
 */
async function generateSkill(body, promptDim) {
  try {
    const res = await callAI({
      systemInstruction: SKILL_SYSTEM_PROMPT,
      userText: body,
      // Gemini 2.5-flash spends tokens on internal reasoning before output, so
      // a small cap yields an empty response; 2000 leaves room for the JSON.
      // response_mime_type is stripped by callGemini (2.5 + system_instruction
      // 400s), so the prompt itself must demand pure JSON.
      generationConfig: { temperature: 0.4, maxOutputTokens: 2000 },
    })
    const parsed = parseAIJson(res.text)
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

    const {
      userId, promptId, body: rawBody, localDate, presetDimension, sourceKit, friendUserId,
      mode: rawMode, selectedItems, removedItemIds, visibleToFriend, itemNotes, wantStory,
    } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!Number.isInteger(promptId) || promptId < 1 || promptId > 9) {
      return NextResponse.json({ error: 'Invalid promptId' }, { status: 400 })
    }
    // Three entries (2026-07-23 需求): 'typing' (流程1, live-matched text),
    // 'prompt' (流程2, my-days guided taps), 'items' (流程3, manual picks).
    // typing requires text; the tap flows require picks and may carry no text.
    const mode = rawMode === 'prompt' || rawMode === 'items' ? rawMode : 'typing'
    const body = typeof rawBody === 'string' ? rawBody : ''
    if (mode === 'typing' && body.length === 0) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 })
    }
    if (body.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Body too long' }, { status: 400 })
    }
    // OTA items: validation + matching run on the MERGED dictionary (bundled
    // + R2 manifest), so no-release items are accepted and matchable.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const DICT = await getMergedDictionary(supabase)

    // Manual picks: [{ itemId, note? }], every id must exist in the dictionary.
    // The note (≤200 chars) becomes the memory excerpt, else the display name.
    let picks = []
    if (mode !== 'typing') {
      if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
        return NextResponse.json({ error: 'No items selected' }, { status: 400 })
      }
      const seen = new Set()
      for (const s of selectedItems.slice(0, 100)) {
        const id = typeof s?.itemId === 'string' ? s.itemId : null
        if (!id || seen.has(id)) continue
        const def = DICT.items[id]
        if (!def) return NextResponse.json({ error: 'Unknown item', itemId: id }, { status: 400 })
        seen.add(id)
        const note = typeof s.note === 'string' ? s.note.trim().slice(0, 200) : ''
        picks.push({ itemId: id, displayName: def.displayName, rarity: def.rarity, label: note || def.displayName })
      }
      if (picks.length === 0) {
        return NextResponse.json({ error: 'No items selected' }, { status: 400 })
      }
    }

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
    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const weekStr = isoWeek(dateStr)

    // SECURITY (2026-08-07 audit): the paid Gemini call fires before the
    // daily-gate RPC, so a rejected reflect still costs an AI call. Cap the
    // AI-bearing path at 6/hour/user (double the 3/day product limit, enough
    // headroom for retries) so a paid token can't loop it for unbounded spend.
    let aiDimensions = []
    if (isPaid && hasConsent && mode === 'typing' && body.length >= 10) {
      const rl = await rateLimit(supabase, `reflect-ai:${userId}`, 6, 3600)
      if (rl.allowed) {
        aiDimensions = await analyzeDimensions(body, pDim)
      }
    }

    const gems = gemsForReflect({
      charCount: body.length,
      promptDimension: pDim,
      aiDimensions,
      isPaid,
    })
    const dimensionHits = gems.credited.map((d) => ({ dimension: d, gems: GEMS_PER_DIMENSION }))

    // XP is a flat 30. The RPC's daily gate (not this endpoint) enforces 3/day,
    // so a successful submit is always one of the first three and pays 30.
    const { data: result, error: rpcErr } = await supabase.rpc('submit_reflect', {
      p_user_id: userId,
      p_prompt_id: promptId,
      p_body: body,
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: XP_RULES.reflect.award,
      p_dimension_hits: dimensionHits,
      p_source_kit: sourceKit === 'new_lens' ? 'new_lens' : null,
      // Per-reflect top-right toggle (default visible); which entry made it.
      p_shared_to_friends: visibleToFriend !== false,
      p_mode: mode,
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
        // typing: engine match minus the chips the user dismissed in the live
        // bar (remove-only — the client can never ADD an unmatched item here).
        // prompt/items: exactly the validated picks.
        let matches
        if (mode === 'typing') {
          const removed = new Set(Array.isArray(removedItemIds) ? removedItemIds.filter((x) => typeof x === 'string') : [])
          matches = matchItems(body, DICT).filter((m) => !removed.has(m.itemId))
          // Pre-submit edit sheet: a user-typed note replaces the engine label.
          if (itemNotes && typeof itemNotes === 'object') {
            matches = matches.map((m) => {
              const note = typeof itemNotes[m.itemId] === 'string' ? itemNotes[m.itemId].trim().slice(0, 200) : ''
              return note ? { ...m, label: note } : m
            })
          }
        } else {
          matches = picks
        }
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

          // Co-creation (PRD §3.7 prompt #9): a reflect written "with" a friend
          // drops its matched items into the pair's shared memory box too,
          // source 'reflect'. Only the rule-matched labels cross over -- never
          // the journal text (default-private posture). The friendship is
          // re-checked here because friendUserId is client-supplied.
          if (friendUserId && typeof friendUserId === 'string' && friendUserId !== userId) {
            const [a, b] = userId < friendUserId ? [userId, friendUserId] : [friendUserId, userId]
            const { data: friendship } = await supabase
              .from('friendships')
              .select('id')
              .eq('user_a', a).eq('user_b', b).eq('status', 'accepted')
              .maybeSingle()
            if (friendship) {
              const boxRows = matches.map((m) => ({
                user_a: a,
                user_b: b,
                author_user_id: userId,
                item_id: m.itemId,
                description: m.label,
                source: 'reflect',
                reflect_id: reflectId,
              }))
              const { error: boxErr } = await supabase.from('shared_memory_items').insert(boxRows)
              if (boxErr) console.warn('[reflect] co-create box insert failed (non-fatal):', boxErr.message)
            }
          }
        }
      } catch (itemErr) {
        console.warn('[reflect] item matching failed (non-fatal):', itemErr && itemErr.message)
      }
    }

    // Plus 回忆精炼 / cute story (2026-07-24). One AI call covers every item
    // the user did NOT describe themselves -- AI never touches an edited
    // item. Story only on the guided flow's Plus button. Best-effort.
    let story = null
    if (reflectId && isPaid && hasConsent && matchedItems.length > 0) {
      try {
        const noted = new Set()
        if (mode === 'typing' && itemNotes && typeof itemNotes === 'object') {
          for (const [k, v] of Object.entries(itemNotes)) {
            if (typeof v === 'string' && v.trim()) noted.add(k)
          }
        } else if (mode !== 'typing' && Array.isArray(selectedItems)) {
          for (const s of selectedItems) {
            if (s && typeof s.note === 'string' && s.note.trim()) noted.add(s.itemId)
          }
        }
        const targets = matchedItems.filter((m) => !noted.has(m.itemId))
        const makeStory = wantStory === true && mode === 'prompt'
        if (makeStory || (targets.length > 0 && body.length >= 10)) {
          const names = matchedItems.map((m) => `${m.itemId}: ${m.displayName}`).join('\n')
          const res = await callAI({
            systemInstruction: makeStory ? STORY_SYSTEM_PROMPT : REFINE_SYSTEM_PROMPT,
            userText: `Items:\n${names}\n\nJournal:\n${body || '(none)'}`,
            generationConfig: { temperature: 0.6, maxOutputTokens: 2000 },
          })
          const parsed = parseAIJson(res.text)
          if (parsed && typeof parsed === 'object') {
            if (makeStory && typeof parsed.story === 'string' && parsed.story.trim()) {
              story = parsed.story.trim().slice(0, 600)
            }
            const descs = parsed.items && typeof parsed.items === 'object' ? parsed.items : {}
            for (const t of targets) {
              const d = typeof descs[t.itemId] === 'string' ? descs[t.itemId].trim().slice(0, 200) : ''
              if (!d) continue
              await supabase
                .from('item_memories')
                .update({ refined_desc: d })
                .eq('user_id', userId)
                .eq('reflect_id', reflectId)
                .eq('item_id', t.itemId)
            }
          }
        }
      } catch (refineErr) {
        console.warn('[reflect] refine/story failed (non-fatal):', refineErr && refineErr.message)
      }
    }

    // Skill acquisition (2026-07 ruling Q13): the FIXED 81-card library,
    // keyword-matched by the engine — a rule engine like item matching, never
    // AI, so every tier earns cards (free users included: no AI cost). A card
    // acquires exactly once (owned set filter + the (user_id, card_id) unique
    // index behind it). Best-effort — never blocks the reflect.
    let generatedSkill = null
    if (reflectId && body.length > 0) {
      try {
        const { data: ownedRows } = await supabase
          .from('skills')
          .select('card_id')
          .eq('user_id', userId)
          .not('card_id', 'is', null)
        const owned = new Set((ownedRows || []).map((r) => r.card_id))
        const newCards = matchSkillCards(body, owned)
        if (newCards.length > 0) {
          const rows = newCards.map((c) => ({
            user_id: userId,
            reflect_id: reflectId,
            dimension: c.group === 'mega' ? null : c.group, // mega sits outside dimension_t
            title: c.title,
            body: c.body,
            rarity: c.tier === 'advanced' ? 'secret' : 'normal',
            source: 'self',
            card_id: c.id,
            tier: c.tier,
          }))
          const { data: inserted, error: insErr } = await supabase
            .from('skills')
            .insert(rows)
            .select('id, card_id')
          if (insErr) {
            // A race on the unique index rejects the batch; the next reflect
            // simply re-filters against the then-owned set. Non-fatal.
            console.warn('[reflect] skill insert skipped:', insErr.message)
          } else {
            // Surface the highest-tier new card on the claim screen.
            const order = { advanced: 3, intermediate: 2, normal: 1 }
            const best = [...newCards].sort((a, b) => order[b.tier] - order[a.tier])[0]
            const bestRow = (inserted || []).find((r) => r.card_id === best.id)
            if (bestRow) {
              generatedSkill = {
                skillId: bestRow.id,
                title: best.title,
                body: best.body,
                dimension: best.group,
                rarity: best.tier === 'advanced' ? 'secret' : 'normal',
                tier: best.tier,
              }
            }
          }
        }
      } catch (skillErr) {
        console.warn('[reflect] skill flow failed (non-fatal):', skillErr && skillErr.message)
      }
    }

    // Companion bubble (best-effort, paid + consented -- same gate as skills;
    // free users get the rotating default lines on Home instead).
    let bubble = null
    if (reflectId && isPaid && hasConsent && mode === 'typing' && body.length >= 10) {
      bubble = await generateBubble(body)
    }

    return NextResponse.json({ success: true, ...result, matchedItems, generatedSkill, bubble, story })
  } catch (err) {
    console.error('[reflect] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
