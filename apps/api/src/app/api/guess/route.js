import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function authed(request) {
  const authHeader = request.headers.get('authorization') || ''
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
async function areFriends(supabase, a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a]
  const { data } = await supabase
    .from('friendships').select('status').eq('user_a', ua).eq('user_b', ub).maybeSingle()
  return data?.status === 'accepted'
}

/**
 * POST /api/guess
 *
 * Body: { userId, action, ... }
 *   action 'submit':  { toUserId, body, targetDate }  -- guess a friend's day
 *   action 'reply':   { guessId, replyTemplateId }    -- react to a guess about me
 *   action 'inbox':   {}                              -- guesses others made about me
 *
 * A guess is private: only the recipient sees it (that's the design). One guess
 * per friend per day (unique constraint). Replies are a fixed template id.
 */
export async function POST(request) {
  try {
    const token = authed(request)
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await request.json()
    const { userId, action } = payload
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = admin()

    if (action === 'submit') {
      const { toUserId, body, targetDate } = payload
      if (!toUserId || !body) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
      if (body.length > 50) return NextResponse.json({ error: 'too_long' }, { status: 400 })
      if (!(await areFriends(supabase, userId, toUserId))) {
        return NextResponse.json({ error: 'not_friends' }, { status: 403 })
      }
      const dateStr = targetDate || new Date().toISOString().slice(0, 10)
      const { error } = await supabase.from('guesses').insert({
        from_user_id: userId, to_user_id: toUserId, target_date: dateStr, body,
      })
      if (error) {
        if (error.code === '23505') return NextResponse.json({ error: 'already_guessed' }, { status: 409 })
        console.error('[guess] submit error:', error.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'reply') {
      const { guessId, replyTemplateId } = payload
      if (guessId == null || replyTemplateId == null) {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
      }
      // Only the recipient can reply.
      const { data: g } = await supabase
        .from('guesses').select('id, to_user_id').eq('id', guessId).maybeSingle()
      if (!g || g.to_user_id !== userId) {
        return NextResponse.json({ error: 'not_allowed' }, { status: 403 })
      }
      const { error } = await supabase
        .from('guesses')
        .update({ reply_template_id: replyTemplateId, replied_at: new Date().toISOString() })
        .eq('id', guessId)
      if (error) {
        console.error('[guess] reply error:', error.message)
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'inbox') {
      // Guesses others made about ME, newest first, with guesser names.
      const { data: rows } = await supabase
        .from('guesses')
        .select('id, from_user_id, target_date, body, reply_template_id, created_at')
        .eq('to_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)
      const fromIds = [...new Set((rows || []).map((r) => r.from_user_id))]
      let nameById = {}
      if (fromIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', fromIds)
        nameById = Object.fromEntries((profs || []).map((p) => [p.id, p.display_name]))
      }
      const inbox = (rows || []).map((r) => ({
        guessId: r.id,
        fromName: nameById[r.from_user_id] || 'A friend',
        targetDate: r.target_date,
        body: r.body,
        replyTemplateId: r.reply_template_id,
        createdAt: r.created_at,
      }))
      return NextResponse.json({ success: true, inbox })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[guess] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
