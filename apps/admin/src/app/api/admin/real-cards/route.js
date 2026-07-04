import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Admin Real-User Cards API
 *
 * GET: List cards a real user actually GENERATED (user_id IS NOT NULL AND
 * wisdom_id IS NOT NULL — i.e. produced from a published wisdom). Onboarding
 * starter cards are seeded per-user with a user_id but NO wisdom_id, so they
 * carry a real user_id yet aren't user-authored; excluding wisdom_id IS NULL
 * keeps them out of this tab (they belong with defaults, not real posts).
 * The clean counterpart to /api/admin/default-cards (user_id IS NULL).
 * The old admin CardsTab "Real Users" sub-tab called the mobile
 * /api/generate-abc-cards?public=true endpoint (which returns default + user
 * cards mixed, default limit 20) and filtered user_id on the client, so it
 * only ever saw real cards inside the newest 20 rows. This route filters
 * server-side and paginates, so every real card is reachable.
 *
 * Query: ?page=0&limit=30&search=...
 */
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '0', 10)
    const limit = parseInt(searchParams.get('limit') || '30', 10)
    const search = (searchParams.get('search') || '').trim()

    let query = supabase
      .from('wisdom_cards')
      .select('*', { count: 'exact' })
      .not('user_id', 'is', null)
      .not('wisdom_id', 'is', null)
      .order('created_at', { ascending: false })
      .range(page * limit, (page + 1) * limit - 1)

    if (search) {
      query = query.or(
        `keyword_id.ilike.%${search}%,quote_short.ilike.%${search}%,insight_full.ilike.%${search}%,creator_name.ilike.%${search}%`,
      )
    }

    const { data, count, error } = await query
    if (error) throw error

    return NextResponse.json({
      success: true,
      cards: data || [],
      total: count || 0,
      hasMore: (page + 1) * limit < (count || 0),
    })
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
