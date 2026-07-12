import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { MONSTERS } from '@novame/engine'

export const runtime = 'edge'

/**
 * GET /api/tame-enemy/status?userId=xxx&localDate=YYYY-MM-DD
 *
 * The Tame Enemy select screen's data. The eight monsters are static (from the
 * engine); this endpoint decorates each with how many skills the user has in
 * that dimension (the monster's skill pool) and whether they've tamed it before
 * (for the "Tamed once" badge), plus whether today's single tame is already
 * spent.
 *
 * The daily limit is one tame across ALL monsters (not per monster), so it's a
 * single kit_completions check for kit='tame_enemy' on localDate.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const localDate = searchParams.get('localDate')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

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

    // Skills grouped by dimension (the per-monster pool size).
    const { data: skills } = await supabase
      .from('skills')
      .select('dimension')
      .eq('user_id', userId)
    const countByDim = {}
    for (const s of skills || []) {
      countByDim[s.dimension] = (countByDim[s.dimension] || 0) + 1
    }

    // Which monsters have been tamed before (distinct monster_id in past
    // tame_enemy completions' payloads).
    const { data: past } = await supabase
      .from('kit_completions')
      .select('payload')
      .eq('user_id', userId)
      .eq('kit', 'tame_enemy')
    const tamedIds = new Set()
    for (const row of past || []) {
      const mid = row.payload?.monster_id
      if (mid) tamedIds.add(mid)
    }

    // Today's single tame spent?
    let doneToday = false
    if (localDate) {
      const { data: today } = await supabase
        .from('kit_completions')
        .select('id')
        .eq('user_id', userId)
        .eq('kit', 'tame_enemy')
        .eq('local_date', localDate)
        .maybeSingle()
      doneToday = !!today
    }

    const monsters = MONSTERS.map((m) => ({
      id: m.id,
      name: m.name,
      dimension: m.dimension,
      prep: m.prep,
      tamed: m.tamed,
      skillCount: countByDim[m.dimension] || 0,
      tamedBefore: tamedIds.has(m.id),
    }))

    return NextResponse.json({ success: true, monsters, doneToday })
  } catch (err) {
    console.error('[tame-enemy/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
