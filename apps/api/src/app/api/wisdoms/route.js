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
 * GET /api/wisdoms?userId=...&limit=20&offset=0
 *
 * Returns the authenticated user's own published wisdoms with their
 * generated card payload joined in. Sorted by created_at desc so the
 * Growth tab's My Logs feed shows newest first.
 *
 * Response shape:
 *   {
 *     success: true,
 *     wisdoms: [{
 *       id, created_at, audio_url, text, categories, duration,
 *       card: { id, keyword_id, quote_short, insight_full,
 *               wisdom_score, wisdom_emotion } | null
 *     }],
 *     total: number     // total count for pagination
 *   }
 *
 * Pagination via limit (default 30, max 100) + offset.
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

    // Total count for pagination UI
    const { count: total } = await supabase
      .from('wisdoms')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    // Page of wisdoms with their card joined
    const { data: wisdoms, error } = await supabase
      .from('wisdoms')
      .select(`
        id, created_at, audio_url, text, categories, duration,
        wisdom_cards (
          id, keyword_id, quote_short, insight_full,
          wisdom_score, wisdom_emotion
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[wisdoms] query failed:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Flatten the joined card (supabase returns array even for 1:1)
    const flattened = (wisdoms || []).map((w) => {
      const cardsArr = Array.isArray(w.wisdom_cards) ? w.wisdom_cards : []
      const card = cardsArr.length > 0 ? cardsArr[0] : null
      const { wisdom_cards: _wc, ...rest } = w
      return { ...rest, card }
    })

    return NextResponse.json({
      success: true,
      wisdoms: flattened,
      total: total || 0,
    })
  } catch (e) {
    console.error('[wisdoms] error:', e.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
