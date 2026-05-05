import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}

/**
 * GET /api/wisdoms?userId=...&limit=30&offset=0
 *
 * Returns the user's own published wisdoms with their generated
 * wisdom_card joined in client-side. We query the two tables
 * separately and stitch them together rather than relying on a
 * PostgREST relation join, because wisdom_cards.wisdom_id may not
 * have an explicit FK constraint registered with PostgREST.
 *
 * Response shape:
 *   {
 *     success: true,
 *     wisdoms: [{
 *       id, created_at, audio_url, text, categories, duration,
 *       card: { id, keyword_id, quote_short, insight_full,
 *               wisdom_score, wisdom_emotion } | null
 *     }],
 *     total: number
 *   }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const supabase = getSupabase()

    const { count: total } = await supabase
      .from('wisdoms')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    const { data: wisdoms, error: wErr } = await supabase
      .from('wisdoms')
      .select('id, created_at, audio_url, text, categories, duration')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (wErr) {
      console.error('[wisdoms] wisdoms query failed:', wErr.message)
      return NextResponse.json({ error: wErr.message }, { status: 500 })
    }

    const wisdomList = wisdoms || []
    let cardByWisdomId = new Map()

    if (wisdomList.length > 0) {
      const ids = wisdomList.map((w) => w.id)
      const { data: cards, error: cErr } = await supabase
        .from('wisdom_cards')
        .select('id, wisdom_id, keyword_id, quote_short, insight_full, wisdom_score, wisdom_emotion')
        .in('wisdom_id', ids)

      if (cErr) {
        console.error('[wisdoms] cards query failed:', cErr.message)
        // Soft-fail: return wisdoms without cards rather than 500.
      } else {
        for (const card of cards || []) {
          if (card.wisdom_id && !cardByWisdomId.has(card.wisdom_id)) {
            cardByWisdomId.set(card.wisdom_id, card)
          }
        }
      }
    }

    const stitched = wisdomList.map((w) => {
      const card = cardByWisdomId.get(w.id) || null
      const cardOut = card
        ? {
            id: card.id,
            keyword_id: card.keyword_id,
            quote_short: card.quote_short,
            insight_full: card.insight_full,
            wisdom_score: card.wisdom_score,
            wisdom_emotion: card.wisdom_emotion,
          }
        : null
      return {
        id: w.id,
        created_at: w.created_at,
        audio_url: w.audio_url,
        text: w.text,
        categories: w.categories,
        duration: w.duration,
        card: cardOut,
      }
    })

    return NextResponse.json({
      success: true,
      wisdoms: stitched,
      total: total || 0,
    })
  } catch (e) {
    console.error('[wisdoms] error:', e?.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
