import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getExpNeeded, getLevelFromExp } from '@/lib/exp'
import { pickStudyBonusTaskTemplate } from '@/lib/study-bonus-tasks'

export const runtime = 'edge'

const WP_MAX = 100
const WP_HUNGER = 40

const STUDY_WP_DECAY_PER_HR = 10   // study mode drains 10 WP/hr
const STUDY_XP_PER_HR = 10         // study earns 10 xp/hr while WP > 0

// EXP earned during a study session. XP accrues at 10/hr only while WP > 0;
// once WP hits 0 the companion is hungry and stops earning. So the earning
// window is capped at the time it takes the starting WP to decay to 0
// (startWp / 10 hours). Net effect: 1 xp per WP point consumed, capped at
// the starting WP (max 100 xp for a full-WP session).
function calcStudyExp(startWp, elapsedSecs) {
  if (!startWp || startWp <= 0) return 0
  const elapsedHrs = elapsedSecs / 3600
  const hrsUntilEmpty = startWp / STUDY_WP_DECAY_PER_HR
  const earningHrs = Math.min(elapsedHrs, hrsUntilEmpty)
  return Math.max(0, Math.floor(earningHrs * STUDY_XP_PER_HR))
}



function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function POST(req) {
  try {
    const { userId, studyStartedAt, wisdomsCreatedDuringStudy = 0 } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // ============================================================
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[study-claim] rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[study-claim] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[study-claim] rejected: token user', _authUser.id, '!= userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_character_id, afk_study_seconds, people_impacted_display, study_bonus_task_index, wp, mode_changed_at')
      .eq('id', userId).single()

    const charId = profile?.active_character_id || 'char-1'
    const { data: charData } = await supabase
      .from('character_data').select('*')
      .eq('user_id', userId).eq('character_id', charId).single()

    // Study duration: derived server-side from mode_changed_at (set when
    // the user switched into study mode) -- the client does not send a
    // start time. The starting WP is profile.wp (written at that switch).
    const startMs = profile?.mode_changed_at ? new Date(profile.mode_changed_at).getTime() : Date.now() - 3600000
    const durationSecs = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
    const studyHours = Math.floor(durationSecs / 3600)
    const studyMins = Math.floor((durationSecs % 3600) / 60)

    // EXP earned = 10/hr while WP > 0, capped at the time WP took to reach 0
    // (startWp / 10 hours). startWp comes from profile.wp (value at switch).
    const startWp = profile?.wp ?? 0
    const expGained = calcStudyExp(startWp, durationSecs)

    // Souls: base random + per-wisdom bonus
    const baseSouls = 3 + Math.floor(Math.random() * 28)
    let totalSouls = baseSouls
    for (let i = 0; i < wisdomsCreatedDuringStudy; i++) {
      totalSouls += 3 + Math.floor(Math.random() * 28)
    }

    // Random card keyword from user's collection
    let cardKeyword = 'Momentum'
    const { data: userCards } = await supabase
      .from('wisdom_cards').select('keyword_id')
      .eq('user_id', userId).not('keyword_id', 'is', null).limit(50)
    if (userCards?.length) {
      const pick = userCards[Math.floor(Math.random() * userCards.length)]
      const { data: kw } = await supabase
        .from('card_keywords').select('keyword').eq('id', pick.keyword_id).single()
      if (kw?.keyword) cardKeyword = kw.keyword
    }

    // Update EXP
    const oldTotalExp = charData?.total_exp || 0
    const newTotalExp = oldTotalExp + expGained
    const oldLevelInfo = getLevelFromExp(oldTotalExp)
    const newLevelInfo = getLevelFromExp(newTotalExp)

    await supabase.from('character_data').update({
      total_exp: newTotalExp, exp: newLevelInfo.currentExp, level: newLevelInfo.level,
    }).eq('user_id', userId).eq('character_id', charId)

    // Switch back to play mode + clear AFK accumulator. We deliberately
    // do NOT refill WP here — WP only refills on publish-wisdom (handled
    // by character-state route's record_complete action). After claim,
    // the companion stays in play with whatever WP they had (typically
    // 0 since claim only runs when WP hits 0).
    await supabase.from('profiles').update({
      character_mode: 'play',
      afk_study_seconds: 0,
    }).eq('id', userId)

    // Update people_impacted_display
    const newImpacted = (profile?.people_impacted_display || 0) + totalSouls

    // Stage 6 follow-up: insert study-bonus quest into daily_tasks.
    // Pick the next template from the user's rotation cursor, INSERT a
    // daily_task row, and write the incremented cursor back.
    //
    // The cursor update is merged into the people_impacted_display
    // UPDATE below to save one round-trip. Both writes touch profiles
    // for the same user, so a single UPDATE statement is strictly
    // cheaper than two.
    const { text: bonusTaskText, nextIndex: nextBonusIndex } =
      pickStudyBonusTaskTemplate(profile?.study_bonus_task_index ?? 0)
    const bonusExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const { error: bonusInsertError } = await supabase.from('daily_tasks').insert({
      user_id: userId,
      task_text: bonusTaskText,
      task_type: 'study_bonus',
      exp_reward: 10,
      is_completed: false,
      expires_at: bonusExpiresAt,
    })
    if (bonusInsertError) {
      // Non-fatal: log and proceed. The study claim itself succeeded
      // (EXP awarded, mode reset). Worst case the user misses one
      // bonus quest -- their cursor still advances on the next claim.
      console.warn('[study-claim] study_bonus task insert failed:', bonusInsertError)
    }

    await supabase.from('profiles').update({
      people_impacted_display: newImpacted,
      people_impacted_updated_at: new Date().toISOString(),
      study_bonus_task_index: nextBonusIndex,
    }).eq('id', userId)

    return NextResponse.json({
      success: true,
      expGained, studyHours, studyMins, totalSouls, cardKeyword,
      resonanceBoost: totalSouls,
      oldExp: oldLevelInfo.currentExp, oldLevel: oldLevelInfo.level, oldExpNeeded: oldLevelInfo.expNeeded,
      newExp: newLevelInfo.currentExp, newLevel: newLevelInfo.level, newExpNeeded: newLevelInfo.expNeeded,
      leveledUp: newLevelInfo.level > oldLevelInfo.level,
    })
  } catch (e) {
    console.error('[study-claim]', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
