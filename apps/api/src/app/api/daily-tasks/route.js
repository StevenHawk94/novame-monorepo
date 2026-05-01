import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Must match character-state API exactly
function getExpNeeded(lv) {
  if (lv <= 5) return 20 + (lv - 1) * 5
  if (lv <= 15) return Math.round(50 + (lv - 6) * 4.44)
  if (lv <= 25) return Math.round(120 + (lv - 16) * 8.89)
  if (lv <= 40) return Math.round(220 + (lv - 26) * 12.86)
  if (lv <= 50) return Math.round(420 + (lv - 41) * 13.33)
  if (lv <= 90) return 800
  return 1000
}

function getLevelFromExp(totalExp) {
  let remaining = totalExp
  for (let lv = 1; lv <= 99; lv++) {
    const needed = getExpNeeded(lv)
    if (remaining < needed) return { level: lv, currentExp: remaining, expNeeded: needed, totalExp }
    remaining -= needed
  }
  return { level: 99, currentExp: 0, expNeeded: 0, totalExp }
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

    const { data: existingDaily } = await supabase
      .from('daily_tasks')
      .select('id')
      .eq('user_id', userId)
      .eq('task_type', 'daily_love')
      .gte('created_at', todayStart)
      .lt('created_at', todayEnd)
      .limit(1)

    if (!existingDaily || existingDaily.length === 0) {
      await supabase.from('daily_tasks').insert({
        user_id: userId,
        task_text: 'Love yourself today ❤️',
        task_type: 'daily_love',
        exp_reward: 10,
        is_completed: false,
        expires_at: todayEnd,
      })
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
