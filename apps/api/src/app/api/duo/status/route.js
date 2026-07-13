import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/duo/status?userId=xxx
 *
 * The duo seat state for a user, from both sides:
 *   - asOwner:  if the user owns a duo subscription, their invite code + whether
 *               the seat is claimed (and by whom). The code is lazily created if
 *               the owner has an active duo sub but no membership row yet (e.g.
 *               apple-iab's best-effort create failed).
 *   - asMember: if the user has claimed someone's duo seat, the owner's name.
 *
 * The code stays visible until the seat is claimed, so the owner can keep
 * sharing it.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified || verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // ── As owner ──
    let asOwner = null
    // Does the user own an active duo subscription?
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan, plan_type, status')
      .eq('user_id', userId)
      .maybeSingle()
    const ownsDuo = sub && sub.plan === 'plus' && sub.plan_type === 'duo' && sub.status === 'active'

    if (ownsDuo) {
      let { data: duo } = await supabase
        .from('duo_memberships')
        .select('invite_code, member_id, status, claimed_at')
        .eq('owner_id', userId)
        .maybeSingle()
      // Lazy-create if missing (apple-iap best-effort may have failed).
      if (!duo) {
        const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
        let code = ''
        for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
        const { data: created } = await supabase
          .from('duo_memberships')
          .insert({ owner_id: userId, invite_code: code, status: 'pending' })
          .select('invite_code, member_id, status, claimed_at')
          .maybeSingle()
        duo = created
      }
      if (duo) {
        let memberName = null
        if (duo.member_id) {
          const { data: m } = await supabase
            .from('profiles').select('display_name').eq('id', duo.member_id).maybeSingle()
          memberName = m?.display_name || 'Your friend'
        }
        asOwner = {
          inviteCode: duo.invite_code,
          claimed: duo.status === 'claimed',
          memberName,
        }
      }
    }

    // ── As member ──
    let asMember = null
    const { data: seat } = await supabase
      .from('duo_memberships')
      .select('owner_id, status')
      .eq('member_id', userId)
      .eq('status', 'claimed')
      .maybeSingle()
    if (seat) {
      const { data: o } = await supabase
        .from('profiles').select('display_name').eq('id', seat.owner_id).maybeSingle()
      asMember = { ownerName: o?.display_name || 'Your friend' }
    }

    return NextResponse.json({ success: true, asOwner, asMember })
  } catch (err) {
    console.error('[duo/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
