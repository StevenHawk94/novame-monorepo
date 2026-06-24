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
 * POST /api/wisdom-card-blocks
 * Body: { userId: string, cardId: string }
 *
 * Records a per-user block of the given wisdom_card. Idempotent:
 * re-blocking an already-blocked card returns success without changing
 * blocked_at (preserves the original block timestamp for any future
 * audit needs).
 *
 * Side effect: the next call to GET /api/seek-questions?userId=X will
 * omit this card from the returned list. There is no unblock endpoint
 * in v1 — the table supports DELETE but no UI surfaces it.
 *
 * Returns: { success: true, blockedAt: ISO string }
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { userId, cardId } = body
    if (!userId || !cardId) {
      return NextResponse.json(
        { error: 'Missing userId or cardId' },
        { status: 400 },
      )
    }

    // ============================================================
    // SECURITY (P3): derive the user from the Bearer token; IGNORE
    // body.userId. service-role client (RLS bypassed) -- without this,
    // anyone could forge blocks for any user. We write user_id =
    // _authUser.id. Mobile apiClient attaches the token.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const _authSupabase = getSupabase()
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const authedUserId = _authUser.id

    const supabase = getSupabase()

    // Check for existing block first to preserve the original timestamp
    // (idempotency contract).
    const { data: existing, error: readErr } = await supabase
      .from('wisdom_card_blocks')
      .select('blocked_at')
      .eq('user_id', authedUserId)
      .eq('card_id', cardId)
      .maybeSingle()

    if (readErr) {
      console.error('POST wisdom-card-blocks read error:', readErr)
      return NextResponse.json({ error: readErr.message }, { status: 500 })
    }

    if (existing) {
      return NextResponse.json({
        success: true,
        blockedAt: existing.blocked_at,
        alreadyBlocked: true,
      })
    }

    const now = new Date().toISOString()
    const { error: insertErr } = await supabase
      .from('wisdom_card_blocks')
      .insert({ user_id: authedUserId, card_id: cardId, blocked_at: now })

    if (insertErr) {
      console.error('POST wisdom-card-blocks insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, blockedAt: now })
  } catch (error) {
    console.error('POST wisdom-card-blocks caught:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
