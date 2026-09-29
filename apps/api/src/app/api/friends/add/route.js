import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { autoGrantDuoBothWays } from '@/lib/duo-auto'

export const runtime = 'edge'

/**
 * POST /api/friends/add
 *
 * Body: { userId, code, preview?, relationship?, relationshipSince? }
 *
 * preview: true resolves the exact code without writing. A real submission
 * pairs both accounts immediately. There is no recipient approval step.
 */
const RELATIONSHIPS = [
  'Partner', 'Best Friend', 'Families', 'Someone Special', 'Others',
  // Keep accepting labels stored by older app versions.
  'Lover', 'Mom and Daughter', 'Siblings',
]

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId, code, preview, relationship, relationshipSince } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const [userRate, ipRate] = await Promise.all([
      rateLimit(supabase, `friend-code:${preview === true ? 'preview' : 'send'}:u:${userId}`, preview === true ? 30 : 10, 3600),
      rateLimit(supabase, `friend-code:ip:${clientIp(request)}`, 80, 3600),
    ])
    if (!userRate.allowed || !ipRate.allowed) {
      return NextResponse.json({ error: 'rate_limited' }, {
        status: 429,
        headers: { 'Retry-After': String(Math.max(userRate.resetIn, ipRate.resetIn, 1)) },
      })
    }

    // Resolve the code to a user.
    const normalized = code.trim().toUpperCase()
    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_default_avatar')
      .eq('invite_code', normalized)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target) {
      return NextResponse.json({ error: 'code_not_found' }, { status: 404 })
    }
    if (target.id === userId) {
      return NextResponse.json({ error: 'cannot_add_self' }, { status: 400 })
    }

    // Search-result preview: name only, nothing written, nothing enumerable
    // (still exact-code matching — no fuzzy lookup surface).
    if (preview === true) {
      return NextResponse.json({
        success: true,
        preview: true,
        targetName: target.display_name || 'Friend',
        targetUserId: target.id,
        targetAvatarUrl: target.avatar_url || '',
        targetIsDefaultAvatar: target.is_default_avatar !== false,
      })
    }

    const rel = RELATIONSHIPS.includes(relationship) ? relationship : null
    const since = typeof relationshipSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(relationshipSince)
      ? relationshipSince
      : null

    const { data: result, error: pairingError } = await supabase.rpc('pair_immediately', {
      p_user_id: userId,
      p_partner_id: target.id,
      p_relationship: rel || 'Partner',
      p_since: since,
    })
    if (pairingError) {
      console.error('[friends/add] instant pairing rpc error:', pairingError.message)
      return NextResponse.json({ error: 'Failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }

    await autoGrantDuoBothWays(supabase, userId, target.id)
    return NextResponse.json({
      success: true,
      pairedWith: target.id,
      pairedName: target.display_name || 'Partner',
      partner: {
        userId: target.id,
        displayName: target.display_name || 'Partner',
        avatarUrl: target.avatar_url || '',
        isDefaultAvatar: target.is_default_avatar !== false,
      },
    })
  } catch (err) {
    console.error('[friends/add] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
