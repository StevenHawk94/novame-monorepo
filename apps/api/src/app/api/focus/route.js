import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/** ISO week like 2026-W28, from a YYYY-MM-DD date string. */
function isoWeek(dateStr) {
  const parts = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * POST /api/focus
 *
 * Body: { userId, sceneId, trackIndex, localDate }
 *
 * Records one completed Focus session: a flat +30 xp, no gems, once a day.
 * submit_kit's once-per-day gate (period = local date) enforces the daily
 * limit. Also logs the session and advances the scene's play cursor so the next
 * run plays the next track (wrapping at the end). Session logging and the cursor
 * bump are best-effort and separate from the xp credit.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { userId, sceneId, trackIndex, localDate } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!sceneId) {
      return NextResponse.json({ error: 'Missing sceneId' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const dateStr = localDate || new Date().toISOString().slice(0, 10)
    const weekStr = isoWeek(dateStr)
    const idx = Number.isFinite(trackIndex) ? trackIndex : 1

    const { data: result, error: rpcErr } = await supabase.rpc('submit_kit', {
      p_user_id: userId,
      p_kit: 'focus',
      p_source: 'focus',
      p_period_key: dateStr, // daily kit: period is the local date
      p_local_date: dateStr,
      p_iso_week: weekStr,
      p_xp_amount: 30,
      p_gem_hits: [],
      p_payload: { scene_id: sceneId, track_index: idx },
    })
    if (rpcErr) {
      console.error('[focus] rpc error:', rpcErr.message)
      return NextResponse.json({ error: 'Submit failed' }, { status: 500 })
    }
    if (result?.error) {
      return NextResponse.json({ error: result.error, ...result }, { status: 409 })
    }

    // Best-effort: log the session + advance the play cursor.
    try {
      await supabase.from('focus_sessions').insert({
        user_id: userId, scene_id: sceneId, track_index: idx, completed: true, local_date: dateStr,
      })
      await supabase.from('user_focus_progress').upsert(
        { user_id: userId, scene_id: sceneId, next_index: idx + 1 },
        { onConflict: 'user_id,scene_id' },
      )
    } catch (logErr) {
      console.warn('[focus] session log failed (non-fatal):', logErr && logErr.message)
    }

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[focus] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
