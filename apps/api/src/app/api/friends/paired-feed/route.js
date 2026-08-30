import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * GET /api/friends/paired-feed?userId=...&date=YYYY-MM-DD
 *
 * The paired partner's icon stream for one day (2026-07-23 需求 §6): the
 * ordered item icons their reflects produced that day — the widget's "emoji
 * message" line and the in-app paired view both read this.
 *
 * Day boundary is the PARTNER's reflect local_date (not a UTC created_at
 * window). Icons only: no reflect text ever rides on this endpoint (widget
 * principle: 图标可上锁屏，文字永不) — and since the per-reflect toggle only
 * gates DETAILS (2026-07-24), every item icon is included here.
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: pairing, error: pairingError } = await supabase
      .from('pairings')
      .select('partner_user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (pairingError) throw pairingError
    if (!pairing) {
      return NextResponse.json({ success: true, paired: false, partner: null, items: [] })
    }
    const partnerId = pairing.partner_user_id

    const [{ data: prof, error: profileError }, { data: reflects, error: reflectsError }] = await Promise.all([
      supabase.from('profiles').select('id, display_name, avatar_url, is_default_avatar').eq('id', partnerId).maybeSingle(),
      supabase
        .from('reflects')
        .select('id')
        .eq('user_id', partnerId)
        .eq('local_date', date),
    ])
    if (profileError || reflectsError) throw profileError || reflectsError

    let items = []
    const reflectIds = (reflects || []).map((r) => r.id)
    if (reflectIds.length > 0) {
      const { data: memories, error: itemsError } = await supabase
        .from('reflect_items')
        .select('item_id, reflect_id, created_at, position')
        .eq('user_id', partnerId)
        .eq('visible_to_paired', true)
        .in('reflect_id', reflectIds)
        .order('created_at', { ascending: true })
        .order('position', { ascending: true })
      if (itemsError) throw itemsError
      items = (memories || []).map((m) => ({
        itemId: m.item_id,
        reflectId: m.reflect_id,
        createdAt: m.created_at,
      }))
    }

    return NextResponse.json({
      success: true,
      paired: true,
      partner: {
        userId: partnerId,
        displayName: prof?.display_name || 'Partner',
        avatarUrl: prof?.avatar_url || '',
        isDefaultAvatar: prof?.is_default_avatar !== false,
      },
      date,
      items,
    })
  } catch (err) {
    console.error('[friends/paired-feed] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
