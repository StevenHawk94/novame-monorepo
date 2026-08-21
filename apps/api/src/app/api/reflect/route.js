import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { getMergedDictionary } from '@/lib/remote-items'
import { createClient } from '@supabase/supabase-js'
import { matchItems, XP_RULES } from '@novame/engine'
import {
  REFLECT_ANALYZER_VERSION,
  REFLECT_COPY_VERSION,
  runReflectAnalyzer,
  runReflectCopy,
} from '@/lib/reflect-ai'
import { loadReflectAnalyzerContext, persistReflectAnalyzerResult } from '@/lib/reflect-analysis-store'
import { recordAIUsage } from '@/lib/ai-usage'

export const runtime = 'edge'

const MAX_BODY_CHARS = 5000
const MAX_ITEMS_PER_REFLECT_CATEGORY = 8

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
 * Computes XP, matches memory items, and produces the paid AI copy, then hands
 * the submission to the submit_reflect RPC. Growth-dimension analysis and
 * Reflect gem crediting are intentionally absent.
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
      userId, promptId, body: rawBody, localDate, sourceKit, friendUserId,
      mode: rawMode, selectedItems, removedItemIds, visibleToFriend, itemNotes,
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

    // Shared Memories creation is Plus-only. Enforce the entitlement at the
    // API boundary as well as in both mobile entry points so stale or modified
    // clients cannot bypass the gate. Existing Ours reads and realtime delivery
    // are intentionally unaffected.
    if (friendUserId && !isPaid) {
      return NextResponse.json({ error: 'plus_required' }, { status: 403 })
    }

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
      p_xp_amount: XP_RULES.reflect.award,
      // Growth Dimensions/Growth Gems were removed from Reflect. Keep the RPC
      // argument for database compatibility until the RPC schema is revised.
      p_dimension_hits: [],
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
    let sharedItems = []
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
              const { data: insertedBoxRows, error: boxErr } = await supabase
                .from('shared_memory_items')
                .insert(boxRows)
                .select('id, author_user_id, item_id, description, source, created_at')
              if (boxErr) console.warn('[reflect] co-create box insert failed (non-fatal):', boxErr.message)
              else sharedItems = insertedBoxRows || []
            }
          }
        }
      } catch (itemErr) {
        console.warn('[reflect] item matching failed (non-fatal):', itemErr && itemErr.message)
      }
    }

    // Plus AI pipeline. Typing reflections run exactly two calls in parallel:
    // reusable analysis + private titles/bunny copy. The local admin dictionary
    // comparison is queued by persistReflectAnalyzerResult and never blocks.
    let bubble = null
    if (reflectId && isPaid && hasConsent) {
      const noted = new Set()
      if (mode === 'typing' && itemNotes && typeof itemNotes === 'object') {
        for (const [key, value] of Object.entries(itemNotes)) {
          if (typeof value === 'string' && value.trim()) noted.add(key)
        }
      } else if (mode !== 'typing' && Array.isArray(selectedItems)) {
        for (const selected of selectedItems) {
          if (selected && typeof selected.note === 'string' && selected.note.trim()) noted.add(selected.itemId)
        }
      }
      const targets = matchedItems.filter((item) => !noted.has(item.itemId))

      const applyDescriptions = async (descriptions) => {
        for (const target of targets) {
          const description = typeof descriptions?.[target.itemId] === 'string'
            ? descriptions[target.itemId].trim().slice(0, 200) : ''
          if (!description) continue
          await supabase.from('item_memories').update({ refined_desc: description })
            .eq('user_id', userId).eq('reflect_id', reflectId).eq('item_id', target.itemId)
          if (friendUserId && typeof friendUserId === 'string') {
            await supabase.from('shared_memory_items').update({ description })
              .eq('author_user_id', userId).eq('reflect_id', reflectId).eq('item_id', target.itemId)
          }
        }
      }

      if (mode === 'typing' && body.trim().length >= 10) {
        let analyzerContext = {
          connectionEligible: false, connectionEnabled: false, currentBoard: null, pair: null,
        }
        try {
          analyzerContext = await loadReflectAnalyzerContext(supabase, {
            userId, visibleToFriend, localDate: dateStr,
          })
        } catch (contextErr) {
          console.warn('[reflect] analyzer context unavailable:', contextErr && contextErr.message)
        }

        const analyzerPromise = runReflectAnalyzer({
          journal: body,
          matchedIcons: matchedItems.map((item) => ({ id: item.itemId, name: item.displayName })),
          weeklyEligible: body.trim().length >= 100,
          connectionEnabled: analyzerContext.connectionEnabled,
          currentConnectionBoard: analyzerContext.connectionEnabled ? analyzerContext.currentBoard : null,
        })
        const copyPromise = runReflectCopy({
          journal: body,
          generateBunny: true,
          items: targets.map((item) => ({ id: item.itemId, name: item.displayName })),
        })
        const [analysisResult, copyResult] = await Promise.allSettled([analyzerPromise, copyPromise])

        if (analysisResult.status === 'fulfilled') {
          await Promise.all([
            persistReflectAnalyzerResult(supabase, {
              reflectId, userId, localDate: dateStr,
              reflectsToday: Number(result?.reflects_today || 1),
              analyzer: analysisResult.value,
              context: analyzerContext,
              matchedItems,
            }),
            recordAIUsage(supabase, {
              userId, feature: 'reflect_analyzer', promptVersion: REFLECT_ANALYZER_VERSION,
              result: analysisResult.value.result, latencyMs: analysisResult.value.latencyMs,
              refId: reflectId,
            }),
          ])
        } else {
          const message = String(analysisResult.reason?.message || analysisResult.reason)
          console.warn('[reflect] analyzer failed (non-fatal):', message)
          await Promise.all([
            supabase.from('reflect_ai_analyses').upsert({
              reflect_id: reflectId, user_id: userId, local_date: dateStr,
              prompt_version: REFLECT_ANALYZER_VERSION, weekly_eligible: false,
              connection_eligible: analyzerContext.connectionEligible,
              connection_mode: 'disabled', status: 'failed', error: message.slice(0, 500),
            }, { onConflict: 'reflect_id' }),
            recordAIUsage(supabase, {
              userId, feature: 'reflect_analyzer', promptVersion: REFLECT_ANALYZER_VERSION,
              success: false, refId: reflectId, error: message,
            }),
          ])
        }

        if (copyResult.status === 'fulfilled') {
          bubble = copyResult.value.data.bunnyText
          await Promise.all([
            applyDescriptions(copyResult.value.data.items),
            recordAIUsage(supabase, {
              userId, feature: 'reflect_copy', promptVersion: REFLECT_COPY_VERSION,
              result: copyResult.value.result, latencyMs: copyResult.value.latencyMs,
              refId: reflectId,
            }),
          ])
        } else {
          const message = String(copyResult.reason?.message || copyResult.reason)
          console.warn('[reflect] copy failed (non-fatal):', message)
          await recordAIUsage(supabase, {
            userId, feature: 'reflect_copy', promptVersion: REFLECT_COPY_VERSION,
            success: false, refId: reflectId, error: message,
          })
        }
      } else if (targets.length > 0 && body.trim().length >= 10) {
        try {
          const copy = await runReflectCopy({
            journal: body, generateBunny: false,
            items: targets.map((item) => ({ id: item.itemId, name: item.displayName })),
          })
          await applyDescriptions(copy.data.items)
        } catch (copyErr) {
          console.warn('[reflect] item copy failed (non-fatal):', copyErr && copyErr.message)
        }
      }
    }

    // AI refinement may have updated the descriptions after the insert. Return
    // the final shared rows so the mounted Ours collection can merge them
    // immediately instead of replacing its full cache with a racing refetch.
    if (sharedItems.length > 0 && reflectId) {
      const { data: finalSharedItems } = await supabase
        .from('shared_memory_items')
        .select('id, author_user_id, item_id, description, source, created_at')
        .eq('author_user_id', userId)
        .eq('reflect_id', reflectId)
        .order('created_at', { ascending: false })
      if (finalSharedItems) sharedItems = finalSharedItems
    }

    return NextResponse.json({ success: true, ...result, matchedItems, sharedItems, bubble })
  } catch (err) {
    console.error('[reflect] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
