import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * GET /api/user-stats?userId=xxx
 *
 * Returns aggregated stats across ALL of a user's wisdoms — used by
 * the Assets tab progress bars (Words for Wisdom Book unlock,
 * unique keywords for Wisdom Cards unlock). Doing the aggregation
 * server-side avoids the client paginating through every wisdom
 * record just to count them; /api/wisdoms is capped at 100 per
 * page and is meant for list views, not analytics.
 *
 * Returns:
 *   {
 *     success: true,
 *     totalWords:      number,  // sum of word counts across user's wisdoms
 *     totalWisdoms:    number,  // number of wisdom rows
 *     uniqueKeywords:  number,  // distinct wisdom_card.keyword_id slugs
 *     keywordCounts:   { [slug]: number }
 *   }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // ?userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[user-stats] rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[user-stats] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[user-stats] rejected: token user', _authUser.id, '!= query userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()

    // --- 1. Total wisdoms + word sum ---
    // We pull only `text` (no audio_url, no description, no joined card)
    // so the payload is small even with thousands of rows. We page
    // through in chunks of 1000 to stay under PostgREST's row cap.
    let totalWords = 0
    let totalWisdoms = 0
    const PAGE = 1000
    let from = 0

    // Loop until a page returns fewer rows than PAGE (last page).
    // Bail at 50 pages (50k wisdoms) as a safety stop.
    for (let i = 0; i < 50; i++) {
      const { data: page, error } = await supabase
        .from('wisdoms')
        .select('text', { count: 'exact' })
        .eq('user_id', userId)
        .range(from, from + PAGE - 1)

      if (error) {
        console.error('user-stats wisdoms query error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const rows = page || []
      totalWisdoms += rows.length
      for (const row of rows) {
        const t = row.text
        if (typeof t === 'string') {
          const words = t.trim().split(/\s+/).filter(Boolean).length
          totalWords += words
        }
      }

      if (rows.length < PAGE) break
      from += PAGE
    }

    // --- 2. Unique keyword slugs from wisdom_cards ---
    // wisdom_cards.user_id mirrors the wisdom's user_id (set on insert
    // in publish-wisdom flow), so we filter directly there. We page
    // the same way to avoid the row cap.
    const slugSet = new Set()
    const slugCounts = {}
    let cardFrom = 0

    for (let i = 0; i < 50; i++) {
      const { data: page, error } = await supabase
        .from('wisdom_cards')
        .select('keyword_id')
        .eq('user_id', userId)
        .range(cardFrom, cardFrom + PAGE - 1)

      if (error) {
        console.error('user-stats cards query error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const rows = page || []
      for (const row of rows) {
        const slug = row.keyword_id
        if (slug) {
          slugSet.add(slug)
          slugCounts[slug] = (slugCounts[slug] || 0) + 1
        }
      }

      if (rows.length < PAGE) break
      cardFrom += PAGE
    }

    return NextResponse.json({
      success: true,
      totalWords,
      totalWisdoms,
      uniqueKeywords: slugSet.size,
      keywordCounts: slugCounts,
    })
  } catch (error) {
    console.error('user-stats error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal error' },
      { status: 500 },
    )
  }
}
