import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getExpNeeded, getLevelFromExp } from '@/lib/exp'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}



/**
 * GET /api/daily-tasks?userId=...
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()
    const now = new Date()

    // Check/create daily love task for today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()

    // Stage 5.WR.2 (Bug 2 fix): daily_love is unique per (user, day) at
    // the DB layer via daily_tasks_uniq_daily_love partial index. Race
    // condition between concurrent requests previously created multiple
    // daily_love rows per day; the unique index now rejects extras
    // (PG error 23505). We still attempt the INSERT to create the row
    // for today, and swallow 23505 silently — the user already has
    // today's row from the racing request, no error to surface.
    const { error: insertError } = await supabase.from('daily_tasks').insert({
      user_id: userId,
      task_text: 'Love yourself today ❤️',
      task_type: 'daily_love',
      exp_reward: 10,
      is_completed: false,
      expires_at: todayEnd,
    })
    // 23505 = unique_violation. Any other error gets logged for visibility.
    if (insertError && insertError.code !== '23505') {
      console.warn('[daily-tasks] daily_love insert error:', insertError)
    }

    // Fetch all active tasks
    const { data: tasks, error } = await supabase
      .from('daily_tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('is_completed', false)
      .gte('expires_at', now.toISOString())
      .order('task_type', { ascending: true })
      .order('created_at', { ascending: false })

    return NextResponse.json({ success: true, tasks: tasks || [] })
  } catch (error) {
    console.error('Daily tasks GET error:', error)
    return NextResponse.json({ success: true, tasks: [] })
  }
}

/**
 * POST /api/daily-tasks
 */
export async function POST(request) {
  try {
    const { userId, action, taskId, tasks } = await request.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()

    // === CREATE wisdom tasks ===
    if (action === 'create' && tasks && tasks.length > 0) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const rows = tasks.map(t => ({
        user_id: userId,
        task_text: (t.text || t).substring(0, 80),
        task_type: 'wisdom',
        exp_reward: 20,
        is_completed: false,
        expires_at: expiresAt,
        linked_keyword: t.keyword || null,
      }))

      await supabase.from('daily_tasks').insert(rows)
      return NextResponse.json({ success: true })
    }

    // === COMPLETE a task ===
    if (action === 'complete' && taskId) {
      // Get task
      const { data: task, error: fetchErr } = await supabase
        .from('daily_tasks')
        .select('*')
        .eq('id', taskId)
        .eq('user_id', userId)
        .eq('is_completed', false)
        .single()

      if (fetchErr || !task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }

      // Mark completed
      await supabase.from('daily_tasks')
        .update({ is_completed: true, completed_at: new Date().toISOString() })
        .eq('id', taskId)

      // Get character data - uses total_exp system
      const { data: profile } = await supabase.from('profiles').select('active_character_id').eq('id', userId).single()
      const charId = profile?.active_character_id || 'char-1'
      
      const { data: charData } = await supabase
        .from('character_data')
        .select('*')
        .eq('user_id', userId)
        .eq('character_id', charId)
        .single()

      if (charData) {
        // Calculate old state from total_exp
        const oldTotalExp = charData.total_exp || 0
        const oldLevelInfo = getLevelFromExp(oldTotalExp)

        // Add EXP
        const newTotalExp = oldTotalExp + task.exp_reward
        const newLevelInfo = getLevelFromExp(newTotalExp)

        // Outfit unlock check
        const outfitLevels = [1, 5, 10, 20, 30, 50]
        const unlocked = outfitLevels.filter(lv => newLevelInfo.level >= lv).map((_, i) => i + 1)

        // Update DB
        await supabase.from('character_data').update({
          total_exp: newTotalExp,
          exp: newLevelInfo.currentExp,
          level: newLevelInfo.level,
          unlocked_outfits: unlocked,
        }).eq('id', charData.id)

        // If task has a linked keyword, add +1 to that aspire score
        if (task.linked_keyword) {
          try {
            const { data: prof } = await supabase.from('profiles').select('aspire_scores').eq('id', userId).single()
            const scores = prof?.aspire_scores || {}
            const current = scores[task.linked_keyword] ?? 70
            scores[task.linked_keyword] = Math.min(100, current + 1)
            const vals = Object.values(scores)
            const avg = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 70
            await supabase.from('profiles').update({ aspire_scores: scores, better_self_score: avg }).eq('id', userId)
          } catch (e) { console.error('Task aspire score error:', e) }
        }

        return NextResponse.json({
          success: true,
          expGained: task.exp_reward,
          // Old state (before adding EXP)
          oldLevel: oldLevelInfo.level,
          oldExpCurrent: oldLevelInfo.currentExp,
          oldExpNeeded: oldLevelInfo.expNeeded,
          // New state (after adding EXP)
          newLevel: newLevelInfo.level,
          expCurrent: newLevelInfo.currentExp,
          expNeeded: newLevelInfo.expNeeded,
          leveledUp: newLevelInfo.level > oldLevelInfo.level,
        })
      }

      return NextResponse.json({ success: true, expGained: task.exp_reward })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Daily tasks POST error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
