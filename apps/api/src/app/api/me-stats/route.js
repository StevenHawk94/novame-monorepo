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
 * GET /api/me-stats?userId=...
 *
 * Aggregates everything the Me page renders, in a single round-trip.
 * Mobile (apps/mobile/src/lib/me-stats.ts) calls this once on app open
 * (warm cache from Home tab) and persists the result to MMKV. The Me
 * modal reads cache only -- never re-fetches on its own.
 *
 * Stage 3.10.1.
 *
 * Response shape (success):
 *   {
 *     success: true,
 *     stats: {
 *       totalWords: number,
 *       totalCards: number,
 *       peopleImpacted: number,
 *       totalExp: number,
 *       betterSelfScore: number,
 *       usedThisMonth: number,
 *       monthlyAnalyses: number,
 *       planTier: 'free'|'basic'|'pro'|'ultra',
 *       planName: 'Free'|'Basic'|'Pro'|'Ultra',
 *     },
 *     profile: {
 *       displayName: string,
 *       avatarUrl: string,
 *     },
 *   }
 *
 * Why server-side aggregate (vs mobile firing 5 endpoints):
 *   - mobile wisdoms route caps at limit=100; client-side word-count
 *     accumulation is unsound for power users
 *   - 1 round-trip vs 5 -- measurable on slow networks
 *   - totalWords here uses select('text').eq('user_id') with no limit,
 *     so it reflects the full corpus regardless of user volume
 */

const TIER_TO_NAME = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  ultra: 'Ultra',
}

// Mirrors PRICING_TIERS.monthlyAnalyses. Inlined here because apps/api
// historically reads pricing inline rather than importing from packages
// (see apps/api/src/app/api/daily-limit/route.js for the same pattern).
const TIER_TO_MONTHLY_ANALYSES = {
  free: 1,
  basic: 15,
  pro: 30,
  ultra: 60,
}

function countWords(text) {
  if (!text) return 0
  const trimmed = String(text).trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).filter(Boolean).length
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const supabase = getSupabase()

    // First-of-month boundary for usedThisMonth, computed server-side
    // (UTC; matches existing daily-limit semantics).
    const now = new Date()
    const firstOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString()

    // 4 parallel queries (totalWords paginated separately below
    // because PostgREST caps non-paginated selects at 1000 rows;
    // matches the loop pattern in /api/user-stats route).
    const [
      profileRes,
      characterRes,
      cardCountRes,
      monthCountRes,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'display_name, avatar_url, better_self_score, people_impacted_display, subscription_tier',
        )
        .eq('id', userId)
        .single(),
      supabase
        .from('character_data')
        .select('total_exp')
        .eq('user_id', userId)
        .order('total_exp', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('wisdom_cards')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('wisdoms')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', firstOfMonth),
    ])

    if (profileRes.error || !profileRes.data) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 },
      )
    }

    const profile = profileRes.data

    // Paginated word count -- mirrors /api/user-stats. Caps at 50 pages
    // (50k wisdoms) as a safety stop. For typical users (N < 1000)
    // this is a single round-trip identical in cost to a non-paginated
    // select, but it stays correct as the user's corpus grows.
    let totalWords = 0
    const PAGE = 1000
    let from = 0
    for (let i = 0; i < 50; i++) {
      const { data: page, error } = await supabase
        .from('wisdoms')
        .select('text')
        .eq('user_id', userId)
        .range(from, from + PAGE - 1)
      if (error) {
        console.error('[me-stats] wisdoms page error:', error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      const rows = page || []
      for (const row of rows) {
        totalWords += countWords(row.text)
      }
      if (rows.length < PAGE) break
      from += PAGE
    }

    const totalCards = cardCountRes.count || 0
    const usedThisMonth = monthCountRes.count || 0
    const totalExp = characterRes.data?.total_exp ?? 0
    const peopleImpacted = profile.people_impacted_display || 0
    const betterSelfScore = profile.better_self_score || 70

    const planTier = profile.subscription_tier || 'free'
    const planName = TIER_TO_NAME[planTier] || 'Free'
    const monthlyAnalyses = TIER_TO_MONTHLY_ANALYSES[planTier] ?? 1

    return NextResponse.json({
      success: true,
      stats: {
        totalWords,
        totalCards,
        peopleImpacted,
        totalExp,
        betterSelfScore,
        usedThisMonth,
        monthlyAnalyses,
        planTier,
        planName,
      },
      profile: {
        displayName: profile.display_name || '',
        avatarUrl: profile.avatar_url || '',
      },
    })
  } catch (e) {
    console.error('[me-stats] error:', e?.message)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
