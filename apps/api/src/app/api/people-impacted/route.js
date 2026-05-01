import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * POST /api/people-impacted
 * Called after each new card is created.
 * Adds real card_saves + random 5-30 per card to people_impacted_display.
 * The display value is delayed 2 hours before showing (tracked via updated_at).
 */
export async function POST(request) {
  try {
    const { userId } = await request.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    const supabase = getSupabase()

    // Get user's card IDs
    const { data: cards } = await supabase
      .from('wisdom_cards').select('id').eq('user_id', userId)
    const cardIds = (cards || []).map(c => c.id)

    // Count real saves
    let realSaves = 0
    if (cardIds.length > 0) {
      const { count } = await supabase
        .from('card_saves').select('id', { count: 'exact', head: true }).in('card_id', cardIds)
      realSaves = count || 0
    }

    // Random boost per new card: 5-30
    const randomBoost = Math.floor(Math.random() * 26) + 5

    // Get current display value
    const { data: profile } = await supabase
      .from('profiles').select('people_impacted_display').eq('id', userId).single()

    const current = profile?.people_impacted_display || 0
    // New value = max of current or realSaves, plus random boost
    const newValue = Math.max(current, realSaves) + randomBoost

    await supabase.from('profiles').update({
      people_impacted_display: newValue,
      people_impacted_updated_at: new Date().toISOString(),
    }).eq('id', userId)

    return NextResponse.json({ success: true, newValue })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * GET /api/people-impacted?userId=xxx
 * Returns the display value (only shows if updated_at > 2 hours ago)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    const supabase = getSupabase()

    const { data: profile } = await supabase
      .from('profiles')
      .select('people_impacted_display, people_impacted_updated_at')
      .eq('id', userId).single()

    const display = profile?.people_impacted_display || 0
    const updatedAt = profile?.people_impacted_updated_at
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    const isReady = !updatedAt || new Date(updatedAt).getTime() < twoHoursAgo

    // If updated within last 2 hours, show previous value (before this boost)
    // Approximate: show 5-30 less than current if not ready
    const shown = isReady ? display : Math.max(0, display - 17)

    return NextResponse.json({ success: true, value: shown })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
