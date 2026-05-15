import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * GET /api/admin/wisdom-card-blocks
 *
 * Returns: { success: true, blocked_cards: [{
 *   card_id, block_count, first_blocked_at, last_blocked_at,
 *   card: { id, keyword_id, quote_short, insight_full, creator_name, creator_avatar } | null
 * }, ...] }
 *
 * Aggregates wisdom_card_blocks by card_id, joining wisdom_cards for
 * display content. PostgREST does not expose GROUP BY directly, so the
 * aggregation happens in JS — fine because the block list is small.
 *
 * Sorted by block_count DESC so the most-frequently-blocked cards
 * appear first.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = getSupabase()

    // Step 1: pull all block rows.
    const { data: blocks, error: blocksErr } = await supabase
      .from('wisdom_card_blocks')
      .select('card_id, blocked_at')

    if (blocksErr) {
      return Response.json({ error: blocksErr.message }, { status: 500 })
    }

    if (!blocks || blocks.length === 0) {
      return Response.json({ success: true, blocked_cards: [] })
    }

    // Step 2: aggregate in JS — group by card_id, count + min/max blocked_at.
    const aggMap = {}
    for (const b of blocks) {
      const existing = aggMap[b.card_id]
      if (!existing) {
        aggMap[b.card_id] = {
          card_id: b.card_id,
          block_count: 1,
          first_blocked_at: b.blocked_at,
          last_blocked_at: b.blocked_at,
        }
      } else {
        existing.block_count++
        if (b.blocked_at < existing.first_blocked_at) {
          existing.first_blocked_at = b.blocked_at
        }
        if (b.blocked_at > existing.last_blocked_at) {
          existing.last_blocked_at = b.blocked_at
        }
      }
    }

    const cardIds = Object.keys(aggMap)

    // Step 3: fetch card content. Some card_ids might be orphans (the
    // underlying wisdom_card was already deleted — we still want to show
    // the block entries so admin can clean up the orphan blocks).
    const { data: cards, error: cardsErr } = await supabase
      .from('wisdom_cards')
      .select('id, keyword_id, quote_short, insight_full, creator_name, creator_avatar')
      .in('id', cardIds)

    if (cardsErr) {
      console.error('[wisdom-card-blocks] cards fetch failed:', cardsErr)
      // Not fatal: return aggregation with card: null.
    }

    const cardMap = Object.fromEntries((cards || []).map(c => [c.id, c]))

    // Step 4: assemble, sort by block_count DESC then last_blocked_at DESC.
    const result = Object.values(aggMap)
      .map(agg => ({ ...agg, card: cardMap[agg.card_id] ?? null }))
      .sort((a, b) => {
        if (b.block_count !== a.block_count) return b.block_count - a.block_count
        return b.last_blocked_at.localeCompare(a.last_blocked_at)
      })

    return Response.json({ success: true, blocked_cards: result })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/wisdom-card-blocks?cardId=X
 *
 * Hard-deletes a wisdom_card. The CASCADE on card_saves and
 * wisdom_card_blocks cleans those up automatically. seek_question_cards
 * has no FK on card_id (legacy schema), so we manually delete its
 * orphan rows before the wisdom_cards DELETE.
 *
 * After this returns, the card is gone from all listing contexts.
 */
export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const cardId = searchParams.get('cardId')

    if (!cardId) {
      return Response.json({ error: 'Missing cardId' }, { status: 400 })
    }

    const supabase = getSupabase()

    // Clean orphan seek_question_cards links first (no FK CASCADE here).
    // Errors are logged but not fatal — the main DELETE below is what
    // matters; leftover seek_question_cards rows are filtered out by
    // the seek-questions GET handler anyway because their card_id
    // won't match any wisdom_cards row.
    const { error: linksErr } = await supabase
      .from('seek_question_cards')
      .delete()
      .eq('card_id', cardId)

    if (linksErr) {
      console.warn('[wisdom-card-blocks] seek_question_cards cleanup failed:', linksErr.message)
    }

    // Main delete. CASCADE cleans card_saves + wisdom_card_blocks.
    const { error: cardErr } = await supabase
      .from('wisdom_cards')
      .delete()
      .eq('id', cardId)

    if (cardErr) {
      return Response.json({ error: cardErr.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
