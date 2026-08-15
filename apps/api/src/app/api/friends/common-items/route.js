import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const WINDOW_DAYS = 60
const MAX_ITEMS = 8
const SCAN_ROWS = 400

/**
 * GET /api/friends/common-items?userId=...
 *
 * Connection Dashboard 板块3: up to 8 items BOTH members of the pairing
 * reflected recently (last 60 days), newest overlap first. For each item both
 * sides' latest memory rides along — my own always; the partner's text only
 * when their privacy allows (global opt-in AND that reflect's toggle),
 * otherwise partner.text is null (icons are always fine).
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: pairing } = await supabase
      .from('pairings')
      .select('partner_user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (!pairing) return NextResponse.json({ success: true, paired: false, items: [] })
    const partnerId = pairing.partner_user_id

    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString()
    const fetchSide = (uid) =>
      supabase
        .from('item_memories')
        .select('item_id, reflect_id, raw_excerpt, refined_desc, created_at')
        .eq('user_id', uid)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(SCAN_ROWS)

    const [{ data: mine }, { data: theirs }, { data: partnerProf }] = await Promise.all([
      fetchSide(userId),
      fetchSide(partnerId),
      supabase.from('profiles').select('share_memory_details, memory_details_mode').eq('id', partnerId).maybeSingle(),
    ])
    const partnerMode = partnerProf?.memory_details_mode || (partnerProf?.share_memory_details === false ? 'none' : 'custom')
    const partnerShares = partnerMode !== 'none'

    // Latest memory per item on each side (rows are newest-first).
    const latestBy = (rows) => {
      const m = new Map()
      for (const r of rows || []) if (!m.has(r.item_id)) m.set(r.item_id, r)
      return m
    }
    const myLatest = latestBy(mine)
    const theirLatest = latestBy(theirs)

    // Overlap, ranked by the partner's recency (their update is the signal).
    const common = [...theirLatest.keys()].filter((id) => myLatest.has(id)).slice(0, MAX_ITEMS)

    // Partner detail gate: global opt-in AND that reflect's visibility toggle.
    const partnerReflectIds = common
      .map((id) => theirLatest.get(id).reflect_id)
      .filter(Boolean)
    const hidden = new Set()
    if (partnerMode === 'custom' && partnerReflectIds.length > 0) {
      const { data: vis } = await supabase
        .from('reflects')
        .select('id, shared_to_friends')
        .in('id', partnerReflectIds)
      for (const r of vis || []) if (r.shared_to_friends === false) hidden.add(r.id)
    }

    const items = common.map((id) => {
      const me = myLatest.get(id)
      const them = theirLatest.get(id)
      const themVisible = partnerShares && !hidden.has(them.reflect_id)
      return {
        itemId: id,
        mine: {
          text: me.refined_desc || me.raw_excerpt,
          reflectId: me.reflect_id,
          createdAt: me.created_at,
        },
        partner: {
          text: themVisible ? them.refined_desc || them.raw_excerpt : null,
          createdAt: them.created_at,
        },
      }
    })

    return NextResponse.json({ success: true, paired: true, items })
  } catch (err) {
    console.error('[friends/common-items] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
