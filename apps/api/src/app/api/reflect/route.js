import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { rateLimit } from '@/lib/rate-limit'
import { getMergedDictionary } from '@/lib/remote-items'
import { createClient } from '@supabase/supabase-js'
import { promptDimension, DIMENSION_IDS } from '@novame/domain'
import { gemsForReflect, GEMS_PER_DIMENSION, matchItems, ITEM_DICTIONARY, XP_RULES } from '@novame/engine'
import { callAI, parseAIJson } from '@/lib/ai'
import { recordItemLearningConcepts } from '@/lib/item-learning'

export const runtime = 'edge'

const MAX_BODY_CHARS = 5000
const MAX_ITEMS_PER_REFLECT_CATEGORY = 8

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

Also extract up to 3 concrete, visually drawable things or activities that are clearly present in the entry but are NOT represented by the supplied matched icon names. Use a short canonical noun phrase, never sensitive interpretation, emotion, diagnosis, person name, or private narrative.

Return ONLY JSON: {"dimensions":["awareness"],"visualConcepts":["ceramic class"]}. dimensions has 0-2 ids; visualConcepts has 0-3 short phrases. No prose or markdown.`

/**
 * AI dimension analysis (paid only). Returns up to two dimension ids from the
 * body, excluding the one the prompt already credits so the two AI slots add
 * breadth rather than repeat. Any failure -- model down, bad JSON -- degrades
 * to [], leaving the user with just the prompt dimension. The economy never
 * blocks on the AI.
 */
async function analyzeDimensions(body, excludeDim, matchedIconNames) {
  try {
    const res = await callAI({
      systemInstruction: DIMENSION_SYSTEM_PROMPT,
      userText: `Matched icon names (do not suggest these again):\n${matchedIconNames.join(', ') || '(none)'}\n\nJournal:\n${body}`,
      // 256-token thinking budget (2026-08-09): enough to weigh an ambiguous
      // entry between dimensions, while capping the reasoning spend.
      generationConfig: {
        temperature: 0.3, maxOutputTokens: 500,
        thinkingConfig: { thinkingBudget: 256 },
      },
    })
    const parsed = parseAIJson(res.text)
    if (!parsed || typeof parsed !== 'object') return { dimensions: [], visualConcepts: [] }
    const dimensions = [...new Set((Array.isArray(parsed.dimensions) ? parsed.dimensions : [])
      .filter((d) => DIMENSION_IDS.includes(d) && d !== excludeDim))].slice(0, 2)
    const visualConcepts = [...new Set((Array.isArray(parsed.visualConcepts) ? parsed.visualConcepts : [])
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim().slice(0, 80)))].slice(0, 3)
    return { dimensions, visualConcepts }
  } catch (err) {
    console.warn('[reflect] dimension analysis failed, degrading to prompt-only:', err && err.message)
    return { dimensions: [], visualConcepts: [] }
  }
}

// Companion bubble: a short, warm one-liner the pet "says" on Home after a
// reflection. First-draft placeholder prompt. Plain text (not JSON) -- one line.
async function generateBubble(body) {
  try {
    const res = await callAI({
      systemInstruction: BUBBLE_SYSTEM_PROMPT,
      userText: body,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 200,
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
    const line = (res.text || '').trim().replace(/^["']|["']$/g, '')
    if (!line || line.length > 200) return null
    return line
  } catch (err) {
    console.warn('[reflect] bubble generation failed (non-fatal):', err && err.message)
    return null
  }
}

const BUBBLE_SYSTEM_PROMPT = `You are the user's companion pet in a personal-growth app. They just finished writing a reflection. Respond with ONE warm, short line, under 25 words, the way their companion would -- caring and specific to what they wrote, like a friend checking in. No preamble. Return ONLY the line: no quotes, no JSON, no markdown.`



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
- the entry's overall mood -- a legitimate choice when it fits (e.g. "The Fried Eggs on an Anxious Lunch"), but item-specific details take priority when they exist

How much to include: rank the distinct details you find for that item by specificity and use the top 1-2. One real detail beats padding in a second; three or more means pick the best 2. A detail unique to that item (a person, a simultaneous action, an origin) always beats a generic one that fits the whole entry (overall mood). Two items may share the same context when that's all the entry gives.

Short or sparse entries:
- When the entry gives little item-specific detail, extend each title from the entry's overall emotional or situational context and the item's stated action or role. Make the title feel like a meaningful memory label instead of returning only "The <name>."
- It is explicitly okay to reuse the same overall context across multiple item titles. Do not force artificial variety when one feeling or situation genuinely connects every item.
- You may express a conservative relationship that is strongly supported by the wording, such as contrast ("despite feeling down"), persistence ("still exercised"), or a stated cause ("watched because I felt down"). Do not invent a person, place, event, motivation, sensory detail, or outcome that the entry does not support.

Title rules:
- No fixed template. Start with "The" + the item (or a natural reference like "Mom's ___"); let the grammar follow the content: adjective, "with ___", "while ___", "that ___", a clause about what happens next. A "mood + day" shape is welcome when the mood genuinely is the best context for that item -- just don't default to it when something more specific is available.
- Use the entry's own wording where possible; light cleanup ok; never invent people, events, or opinions.
- Roughly 6-15 words with one detail, up to 20 words with two. Accuracy and natural phrasing matter more than filling the maximum length.
- Title Case; keep connectors (a, an, on, to, by, of, with, that, while) lowercase unless first.
- If the entry says nothing about an item at all, "The <name>" plus the day's mood is a good fallback.

Examples (not templates):
Entry: "I felt unhappy today, but I ate dinner, exercised, and watched a movie."
-> dinner: "The Dinner I Still Ate on a Hard Day"
-> exercise: "The Exercise I Still Pushed Through While Feeling Down"
-> movie: "The Movie I Watched While Feeling Down"

Entry: "Mom made me a sandwich before I watched a show."
-> sandwich: "Mom's Sandwich Before the Show"

Return ONLY JSON: { "items": { "<itemId>": "<title>", ... } }, one entry per input item. No prose, no markdown, no reasoning.`

// Plus cute story (流程2, PLACEHOLDER copy): a tiny warm story of the day
// woven from the picked items, to share with the paired person.
const STORY_SYSTEM_PROMPT = `You write a tiny, cute story (3-5 sentences, max 90 words) about someone's day, woven from the items they picked and any note they left. Warm, playful, second person ("you"), no emoji spam (one or two is fine).

Also write one short caption per item (max 12 words) that matches the story.

Return ONLY JSON: { "story": "<the story>", "items": { "<itemId>": "<caption>", ... } }. No prose, no markdown.`


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
    const removedForTyping = new Set(Array.isArray(removedItemIds)
      ? removedItemIds.filter((x) => typeof x === 'string') : [])
    const preliminaryMatches = mode === 'typing'
      ? matchItems(body, DICT).filter((m) => !removedForTyping.has(m.itemId)) : []

    // Manual picks: [{ itemId, note? }], every id must exist in the dictionary.
    // The note (≤200 chars) becomes the memory excerpt, else the display name.
    let picks = []
    if (mode !== 'typing') {
      if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
        return NextResponse.json({ error: 'No items selected' }, { status: 400 })
      }
      const seen = new Set()
      const categoryCounts = new Map()
      for (const s of selectedItems.slice(0, 100)) {
        const id = typeof s?.itemId === 'string' ? s.itemId : null
        if (!id || seen.has(id)) continue
        const def = DICT.items[id]
        if (!def) return NextResponse.json({ error: 'Unknown item', itemId: id }, { status: 400 })
        const category = def.category || 'Uncategorized'
        const categoryCount = (categoryCounts.get(category) || 0) + 1
        if (categoryCount > MAX_ITEMS_PER_REFLECT_CATEGORY) {
          return NextResponse.json({
            error: 'too_many_items_in_category', category,
            limit: MAX_ITEMS_PER_REFLECT_CATEGORY,
          }, { status: 400 })
        }
        categoryCounts.set(category, categoryCount)
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

    // Shared Memories is a Reflect path. Free members author every memory
    // description themselves; Plus may leave notes blank for AI refinement.
    // Enforce this server-side as well as in the UI so the old direct-create
    // behavior cannot be recreated by a stale or modified client.
    if (friendUserId && mode === 'typing' && !isPaid) {
      if (preliminaryMatches.length === 0) {
        return NextResponse.json({ error: 'No items matched' }, { status: 400 })
      }
      const complete = itemNotes && typeof itemNotes === 'object'
        && preliminaryMatches.every((match) =>
          typeof itemNotes[match.itemId] === 'string' && itemNotes[match.itemId].trim().length > 0)
      if (!complete) {
        return NextResponse.json({ error: 'Shared memory descriptions required' }, { status: 400 })
      }
    }

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
    let learningConcepts = []
    if (isPaid && hasConsent && mode === 'typing' && body.length >= 10) {
      const rl = await rateLimit(supabase, `reflect-ai:${userId}`, 6, 3600)
      if (rl.allowed) {
        const analysis = await analyzeDimensions(
          body, pDim, preliminaryMatches.slice(0, 20).map((match) => match.displayName),
        )
        aiDimensions = analysis.dimensions
        learningConcepts = analysis.visualConcepts
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
          matches = preliminaryMatches
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
          // re-checked here because friendUserId is client-supplied. Only the
          // current pairing can create Ours items; historical friendships are
          // retained but do not grant access after unpairing.
          if (friendUserId && typeof friendUserId === 'string' && friendUserId !== userId) {
            const [a, b] = userId < friendUserId ? [userId, friendUserId] : [friendUserId, userId]
            const { data: pairing } = await supabase
              .from('pairings')
              .select('partner_user_id')
              .eq('user_id', userId)
              .maybeSingle()
            if (pairing?.partner_user_id === friendUserId) {
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

    if (reflectId && learningConcepts.length > 0) {
      try {
        await recordItemLearningConcepts(supabase, learningConcepts, DICT, matchedItems)
      } catch (learningErr) {
        console.warn('[reflect] item learning failed (non-fatal):', learningErr && learningErr.message)
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
            // Structured short-copy task: thinking OFF (2026-08-09 cost pass)
            // — output tokens drop ~4x with no quality loss on titles.
            generationConfig: {
              temperature: 0.6, maxOutputTokens: 2000,
              thinkingConfig: { thinkingBudget: 0 },
            },
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
              // Shared Memories uses the same Reflect pipeline. Keep the
              // pair's Ours copy in sync with the Plus AI-refined description.
              if (friendUserId && typeof friendUserId === 'string') {
                await supabase
                  .from('shared_memory_items')
                  .update({ description: d })
                  .eq('author_user_id', userId)
                  .eq('reflect_id', reflectId)
                  .eq('item_id', t.itemId)
              }
            }
          }
        }
      } catch (refineErr) {
        console.warn('[reflect] refine/story failed (non-fatal):', refineErr && refineErr.message)
      }
    }

    // Companion bubble (best-effort, paid + consented -- paid + consented only;
    // free users get the rotating default lines on Home instead).
    let bubble = null
    if (reflectId && isPaid && hasConsent && mode === 'typing' && body.length >= 10) {
      bubble = await generateBubble(body)
    }

    return NextResponse.json({ success: true, ...result, matchedItems, bubble, story })
  } catch (err) {
    console.error('[reflect] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
