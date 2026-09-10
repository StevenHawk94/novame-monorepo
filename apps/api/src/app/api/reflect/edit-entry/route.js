import { after, NextResponse } from 'next/server'
import { MAX_REFLECT_ITEMS } from '@novame/engine'

import { verifyToken } from '@/lib/auth-guard'
import { recordAIUsage } from '@/lib/ai-usage'
import { analyzeFinalizedReflect } from '@/lib/reflect-completion'
import { enqueueReflectAnalysisJob, processReflectAnalysisJobs } from '@/lib/reflect-analysis-jobs'
import {
  createMemoryCopy,
  createMemoryFallbacks,
  MAX_BODY_CHARS,
  resolveDraftInput,
  serviceClient,
} from '@/lib/reflect-draft'
import { REFLECT_COPY_VERSION } from '@/lib/reflect-ai'

export const runtime = 'edge'
export const maxDuration = 60

function existingMatch(row) {
  const item = Array.isArray(row.items) ? row.items[0] : row.items
  const displayName = item?.display_name || row.match_label || row.item_id
  return {
    itemId: row.item_id,
    displayName,
    rarity: item?.rarity || 'common',
    label: row.match_label || displayName,
    sourceExcerpt: row.source_excerpt || '',
  }
}

function statusFor(error) {
  if (error === 'not_found') return 404
  if (error === 'empty' || error === 'invalid_body' || error === 'invalid_items'
    || error === 'invalid_payload' || error === 'too_long' || error === 'too_many_items') return 400
  return 500
}

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const input = await request.json()
    if (verified.id !== input.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (typeof input.reflectId !== 'string' || typeof input.body !== 'string') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const body = input.body.trim()
    if (body.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'too_long' }, { status: 400 })
    }

    const supabase = serviceClient()
    const [reflectResult, rowsResult, profileResult] = await Promise.all([
      supabase.from('reflects')
        .select('id, mode, local_date, shared_to_friends, shared_with_user_id, journal_kind')
        .eq('id', input.reflectId).eq('user_id', input.userId).maybeSingle(),
      supabase.from('reflect_items')
        .select('item_id, position, match_label, source_excerpt, items(display_name, rarity)')
        .eq('reflect_id', input.reflectId).eq('user_id', input.userId).order('position'),
      supabase.from('profiles').select('subscription_tier, ai_consent_at')
        .eq('id', input.userId).maybeSingle(),
    ])
    const sourceError = reflectResult.error || rowsResult.error || profileResult.error
    if (sourceError) throw sourceError
    const reflect = reflectResult.data
    const rows = rowsResult.data
    const profile = profileResult.data
    if (!reflect) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    let matches
    if (reflect.mode === 'typing') {
      const { data: removals, error: removalsError } = await supabase.from('item_match_removals')
        .select('item_id').eq('reflect_id', input.reflectId)
      if (removalsError) throw removalsError
      const resolved = await resolveDraftInput(supabase, {
        mode: 'typing',
        body,
        matchingVersion: input.matchingVersion,
        removedItemIds: [...new Set((removals || []).map((row) => row.item_id))],
      })
      if (resolved.error) {
        return NextResponse.json({ error: resolved.error }, { status: statusFor(resolved.error) })
      }
      matches = resolved.matches
    } else {
      // Tap Your Day / selected-item entries keep the icons the user chose.
      // Editing their optional note must never reinterpret it as a keyword
      // journal and silently replace those explicit choices.
      matches = (rows || []).map(existingMatch)
    }
    if (matches.length > MAX_REFLECT_ITEMS) {
      return NextResponse.json({ error: 'too_many_items' }, { status: 400 })
    }

    const isPaid = (profile?.subscription_tier || 'free') !== 'free'
    const canGenerateMemories = isPaid && !!profile?.ai_consent_at && body.length > 0
    let memories = createMemoryFallbacks({ body, matches })
    let copyUsage = null
    if (canGenerateMemories && matches.length > 0) {
      const generated = await createMemoryCopy({ body, matches, generateBunny: false })
      memories = generated.memories
      copyUsage = generated.usage
    }

    const { data: result, error: editError } = await supabase.rpc('edit_journal_entry', {
      p_user_id: input.userId,
      p_reflect_id: input.reflectId,
      p_body: body,
      p_matches: matches,
      p_auto_memories: memories,
      p_create_auto_memories: canGenerateMemories,
    })
    if (editError) {
      console.error('[reflect/edit-entry] rpc:', editError.message)
      return NextResponse.json({ error: 'edit_failed' }, { status: 500 })
    }
    if (!result) {
      return NextResponse.json({ error: 'edit_failed' }, { status: 500 })
    }
    if (result.error) {
      return NextResponse.json(result, { status: statusFor(result.error) })
    }

    if (copyUsage) {
      await recordAIUsage(supabase, {
        userId: input.userId,
        feature: 'reflect_copy',
        promptVersion: REFLECT_COPY_VERSION,
        result: copyUsage.result,
        latencyMs: copyUsage.latencyMs,
        refId: input.reflectId,
      })
    }

    await Promise.all([
      supabase.rpc('broadcast_reflect_feed_change', { p_user_id: input.userId }),
      result.shared
        ? supabase.rpc('broadcast_shared_box_reflect_change', {
          p_user_id: input.userId,
          p_reflect_id: input.reflectId,
        })
        : Promise.resolve(),
    ])

    if (body) {
      try {
        const queued = await enqueueReflectAnalysisJob(supabase, {
          reflectId: input.reflectId,
          userId: input.userId,
          localDate: reflect.local_date,
          journalKind: reflect.journal_kind || (reflect.mode === 'prompt' ? 'tap_your_day' : 'write_freely'),
          reset: true,
        })
        if (queued) after(() => processReflectAnalysisJobs({ reflectId: input.reflectId }))
      } catch (queueError) {
        console.warn('[reflect/edit-entry] analysis enqueue failed:', queueError?.message || queueError)
        after(() => analyzeFinalizedReflect({
          userId: input.userId,
          draft: { body, matches, local_date: reflect.local_date, journal_kind: reflect.journal_kind },
          result: {
            reflect_id: input.reflectId,
            shared_to_friends: reflect.shared_to_friends,
            reflects_today: 1,
          },
        }))
      }
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[reflect/edit-entry] unexpected:', error?.message || error)
    return NextResponse.json({ error: 'edit_failed' }, { status: 500 })
  }
}
