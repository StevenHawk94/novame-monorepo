import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function requireUser(request) {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  return verifyToken(token)
}

/**
 * The 1:1 pairing (2026-07-23 需求: 那个愿意共享生活点滴、不在身边的人).
 * Built on friendships — you can only pair with an accepted friend; each user
 * holds at most one pairing (enforced by the pairings PK, both directions
 * written atomically by the set_pairing RPC).
 *
 * GET    ?userId=            → { paired, partner: { userId, displayName } | null }
 * POST   { userId, friendUserId } → pair with that accepted friend
 * DELETE { userId }          → unpair (either member can end it)
 */
export async function GET(request) {
  try {
    const verified = await requireUser(request)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = serviceClient()
    const { data: row } = await supabase
      .from('pairings')
      .select('partner_user_id, relationship, relationship_since, created_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (!row) return NextResponse.json({ success: true, paired: false, partner: null })

    const { data: prof } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_default_avatar')
      .eq('id', row.partner_user_id)
      .maybeSingle()
    // Duration: since the relationship's stated start when given, else since
    // the pairing itself.
    const sinceIso = row.relationship_since || (row.created_at ? row.created_at.slice(0, 10) : null)
    const days = sinceIso
      ? Math.max(0, Math.floor((Date.now() - new Date(`${sinceIso}T00:00:00Z`).getTime()) / 86400000))
      : 0
    return NextResponse.json({
      success: true,
      paired: true,
      partner: {
        userId: row.partner_user_id,
        displayName: prof?.display_name || 'Partner',
        avatarUrl: prof?.avatar_url || '',
        isDefaultAvatar: prof?.is_default_avatar !== false,
      },
      relationship: row.relationship || null,
      relationshipSince: row.relationship_since || null,
      pairedDays: days,
    })
  } catch (err) {
    console.error('[friends/pair] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const verified = await requireUser(request)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, friendUserId } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!friendUserId || typeof friendUserId !== 'string') {
      return NextResponse.json({ error: 'Missing friendUserId' }, { status: 400 })
    }

    const supabase = serviceClient()
    const { data: result, error } = await supabase.rpc('set_pairing', {
      p_user_id: userId,
      p_partner_id: friendUserId,
    })
    if (error) {
      console.error('[friends/pair] rpc error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }
    return NextResponse.json({ success: true, pairedWith: friendUserId })
  } catch (err) {
    console.error('[friends/pair] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const verified = await requireUser(request)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = serviceClient()
    const { data: result, error } = await supabase.rpc('unset_pairing', { p_user_id: userId })
    if (error) {
      console.error('[friends/pair] rpc error:', error.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[friends/pair] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
