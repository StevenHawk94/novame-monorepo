import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { MONSTERS, TAME_POINTS_PER_COMPLETION } from '@novame/engine'
import { resolveUserLocalDate } from '@/lib/user-local-date'

export const runtime = 'edge'

/**
 * GET /api/tame-enemy/status?userId=xxx&localDate=YYYY-MM-DD
 *
 * The Tame Enemy select screen's data. The eight monsters are static (from the
 * engine); this endpoint decorates each with how many skills the user has in
 * that dimension (the monster's skill pool) and whether they've tamed it before
 * (for the exact "Tamed N×" badge), plus today's per-monster availability.
 *
 * Free users can tame three times across all monsters per day. Plus users can
 * tame each monster once per day.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const requestedLocalDate = searchParams.get('localDate')
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
    const localDate = await resolveUserLocalDate(supabase, userId)

    // Skills grouped by dimension (the per-monster pool size).
    const { data: skills } = await supabase
      .from('skills')
      .select('dimension')
      .eq('user_id', userId)
    const countByDim = {}
    for (const s of skills || []) {
      countByDim[s.dimension] = (countByDim[s.dimension] || 0) + 1
    }

    // Per-monster tame history drives badges; today's set drives paid
    // per-enemy availability. Points themselves are a fixed +50 per tame.
    const { data: past } = await supabase
      .from('kit_completions')
      .select('payload, local_date')
      .eq('user_id', userId)
      .eq('kit', 'tame_enemy')
    const tamedCounts = new Map()
    const tamedTodayIds = new Set()
    let tamesToday = 0
    for (const row of past || []) {
      const mid = row.payload?.monster_id
      if (!mid) continue
      tamedCounts.set(mid, (tamedCounts.get(mid) || 0) + 1)
      if (localDate && row.local_date === localDate) {
        tamedTodayIds.add(mid)
        tamesToday++
      }
    }
    // (The old .maybeSingle() here errored once paid users had >1 row a day.)

    // Tier decides the daily shape: free = one tame across all monsters,
    // paid = one per monster (PRD benefits matrix).
    const { data: profile } = await supabase
      .from('profiles').select('subscription_tier').eq('id', userId).maybeSingle()
    const perEnemyDaily = (profile?.subscription_tier ?? 'free') !== 'free'
    const doneToday = perEnemyDaily
      ? tamedTodayIds.size >= MONSTERS.length
      : tamesToday >= 3

    // Each enemy owns its own Tame History score. The completion-count fallback
    // also keeps status correct during rollout and for any legacy row that was
    // not backfilled into monster_battle_progress.
    const { data: progress, error: progressError } = await supabase
      .from('monster_battle_progress')
      .select('monster_id, points')
      .eq('user_id', userId)
    if (progressError) {
      console.error('[tame-enemy/status] monster progress error:', progressError.message)
    }
    const pointsByMonster = new Map(
      (progress || []).map((row) => [row.monster_id, Math.max(0, Number(row.points) || 0)]),
    )

    const monsters = MONSTERS.map((m) => {
      const tamedCount = tamedCounts.get(m.id) || 0
      return {
        id: m.id,
        name: m.name,
        dimension: m.dimension,
        prep: m.prep,
        tamed: m.tamed,
        skillCount: countByDim[m.dimension] || 0,
        tamedBefore: tamedCount > 0,
        tamedCount,
        battlePoints: pointsByMonster.get(m.id) ?? (tamedCount * TAME_POINTS_PER_COMPLETION),
        tamedToday: tamedTodayIds.has(m.id),
      }
    })

    return NextResponse.json({ success: true, monsters, doneToday, perEnemyDaily })
  } catch (err) {
    console.error('[tame-enemy/status] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
