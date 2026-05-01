import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const WP_MAX = 100
const WP_HUNGER = 40

function calcAFKExp(accumSecs) {
  // Study: 10xp/hr above hunger, 5xp/hr below hunger
  // Approximate: WP spends half above hunger, half below
  const secsPerExpFull = 0.1 * 3600   // 10xp/hr = 1 exp per 360s
  const secsPerExpHungry = 0.2 * 3600  // 5xp/hr = 1 exp per 720s
  const halfSecs = accumSecs / 2
  return Math.floor(halfSecs / secsPerExpFull) + Math.floor(halfSecs / secsPerExpHungry)
}

function getExpNeeded(lv) {
  if (lv <= 5) return 20 + (lv - 1) * 5
  if (lv <= 15) return Math.round(50 + (lv - 6) * 4.44)
  if (lv <= 25) return Math.round(120 + (lv - 16) * 8.89)
  if (lv <= 40) return Math.round(220 + (lv - 26) * 12.86)
  if (lv <= 50) return Math.round(420 + (lv - 41) * 13.33)
  return Math.round(560 + (lv - 51) * 20)
}

function getLevelFromExp(totalExp) {
  let level = 1, accumulated = 0
  while (true) {
    const needed = getExpNeeded(level)
    if (accumulated + needed > totalExp) break
    accumulated += needed
    level++
  }
  return { level, currentExp: totalExp - accumulated, expNeeded: getExpNeeded(level) }
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function POST(req) {
  try {
    const { userId, studyStartedAt, wisdomsCreatedDuringStudy = 0 } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()

    const { data: profile } = await supabase
      .from('profiles')
      .select('active_character_id, afk_study_seconds, people_impacted_display')
      .eq('id', userId).single()

    const charId = profile?.active_character_id || 'char-1'
    const { data: charData } = await supabase
      .from('character_data').select('*')
      .eq('user_id', userId).eq('character_id', charId).single()

    // Study duration
    const startMs = studyStartedAt ? new Date(studyStartedAt).getTime() : Date.now() - 3600000
    const durationSecs = Math.max(60, Math.floor((Date.now() - startMs) / 1000))
    const studyHours = Math.floor(durationSecs / 3600)
    const studyMins = Math.floor((durationSecs % 3600) / 60)

    // EXP: use actual session duration only (not stale DB accumulator)
    const expGained = Math.max(1, calcAFKExp(durationSecs))

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

    // Reset: back to play, full WP, clear afk accumulator
    await supabase.from('profiles').update({
      character_mode: 'play', wp: WP_MAX,
      wp_last_updated: new Date().toISOString(), afk_study_seconds: 0,
    }).eq('id', userId)

    // Update people_impacted_display
    const newImpacted = (profile?.people_impacted_display || 0) + totalSouls
    await supabase.from('profiles').update({
      people_impacted_display: newImpacted,
      people_impacted_updated_at: new Date().toISOString(),
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
