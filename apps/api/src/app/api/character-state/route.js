import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const WP_MAX = 100
const WP_STUDY_DECAY = 10
const WP_PLAY_DECAY = 5
const WP_HUNGER = 40
// EXP is now based on wisdom_score (70-100) per wisdom created

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

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
    if (remaining < needed) return { level: lv, currentExp: remaining, expNeeded: needed, totalExp, progress: remaining / needed }
    remaining -= needed
  }
  return { level: 99, currentExp: 0, expNeeded: 0, totalExp, progress: 1 }
}

function calcWP(wpStart, mode, elapsedMs) {
  if (!wpStart || wpStart <= 0) return 0
  const hrs = elapsedMs / 3600000
  const rate = mode === 'study' ? WP_STUDY_DECAY : WP_PLAY_DECAY
  return Math.max(0, Math.round(wpStart - hrs * rate))
}

function calcAFKExp(mode, wp, accumSecs, newSecs) {
  if (wp <= 0) return { exp: 0, remain: accumSecs + newSecs }
  const total = accumSecs + newSecs
  const hungry = wp <= WP_HUNGER
  let secsPerExp
  // Study: 10xp/hr full, 10xp/2hr hungry. Play: 10xp/4hr full, 10xp/8hr hungry
  if (mode === 'study') secsPerExp = (hungry ? 0.2 : 0.1) * 3600
  else secsPerExp = (hungry ? 0.8 : 0.4) * 3600
  return { exp: Math.floor(total / secsPerExp), remain: total % secsPerExp }
}

/**
 * Ensure character_data row exists for this user+character.
 * Auto-creates if missing.
 */
async function ensureCharacterData(supabase, userId, characterId) {
  const { data } = await supabase
    .from('character_data')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single()
  
  if (data) return data

  // Auto-create
  const { data: created, error } = await supabase
    .from('character_data')
    .insert({
      user_id: userId,
      character_id: characterId,
      character_name: '',
      level: 1,
      exp: 0,
      total_exp: 0,
      total_recording_seconds: 0,
      total_cards_created: 0,
      current_outfit: 1,
      unlocked_outfits: [1],
      is_unlocked: true,
    })
    .select()
    .single()

  if (error) console.error('Auto-create character_data error:', error)
  return created
}

/**
 * Ensure profile has character fields initialized
 */
async function ensureProfileFields(supabase, userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('active_character_id, character_mode, wp, wp_last_updated')
    .eq('id', userId)
    .single()

  if (!profile) return null

  // If any character field is missing, initialize
  if (!profile.active_character_id || profile.wp === null || profile.wp === undefined) {
    const now = new Date().toISOString()
    const updates = {}
    if (!profile.active_character_id) updates.active_character_id = 'char-1'
    if (!profile.character_mode) updates.character_mode = 'play'
    if (profile.wp === null || profile.wp === undefined) updates.wp = 0
    if (!profile.wp_last_updated) updates.wp_last_updated = now

    if (Object.keys(updates).length > 0) {
      await supabase.from('profiles').update(updates).eq('id', userId)
    }

    return {
      ...profile,
      active_character_id: profile.active_character_id || 'char-1',
      character_mode: profile.character_mode || 'play',
      wp: profile.wp ?? 0,
      wp_last_updated: profile.wp_last_updated || now,
    }
  }

  return profile
}

/**
 * GET /api/character-state?userId=xxx
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()

    // Ensure profile has character fields
    const profileBase = await ensureProfileFields(supabase, userId)
    if (!profileBase) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Re-read full profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_character_id, character_mode, wp, wp_last_updated, mode_changed_at, afk_study_seconds, afk_play_seconds, last_recording_at')
      .eq('id', userId)
      .single()

    const charId = profile.active_character_id || 'char-1'

    // Ensure character_data exists
    const charData = await ensureCharacterData(supabase, userId, charId)

    const now = Date.now()
    const mode = profile.character_mode || 'play'
    const wpLastUpdated = profile.wp_last_updated || new Date().toISOString()
    const elapsed = now - new Date(wpLastUpdated).getTime()
    const currentWP = calcWP(profile.wp ?? 0, mode, Math.max(0, elapsed))

    const elapsedSecs = Math.max(0, Math.floor(elapsed / 1000))
    const afkAccum = mode === 'study' ? (profile.afk_study_seconds || 0) : (profile.afk_play_seconds || 0)
    const afk = (profile.wp || 0) > 0 ? calcAFKExp(mode, currentWP, afkAccum, elapsedSecs) : { exp: 0, remain: afkAccum + elapsedSecs }

    const totalExp = (charData?.total_exp || 0) + afk.exp
    const levelInfo = getLevelFromExp(totalExp)

    // Write back
    if (afk.exp > 0 || currentWP !== (profile.wp ?? 0)) {
      await supabase.from('profiles').update({
        wp: currentWP,
        wp_last_updated: new Date(now).toISOString(),
        [mode === 'study' ? 'afk_study_seconds' : 'afk_play_seconds']: afk.remain,
      }).eq('id', userId)

      if (afk.exp > 0 && charData) {
        await supabase.from('character_data').update({
          total_exp: totalExp, exp: levelInfo.currentExp, level: levelInfo.level,
        }).eq('id', charData.id)
      }
    }

    const { data: allChars } = await supabase.from('character_data').select('*').eq('user_id', userId).order('character_id')

    return NextResponse.json({
      success: true,
      activeCharacterId: charId,
      mode,
      wp: currentWP,
      character: charData ? { ...charData, total_exp: totalExp, exp: levelInfo.currentExp, level: levelInfo.level } : null,
      levelInfo,
      allCharacters: allChars || [],
    })
  } catch (error) {
    console.error('GET character-state error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/character-state
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { userId, action } = body
    if (!userId || !action) return NextResponse.json({ error: 'Missing userId or action' }, { status: 400 })

    const supabase = getSupabase()

    // Ensure profile fields for all actions
    await ensureProfileFields(supabase, userId)

    if (action === 'switch_mode') {
      const { mode } = body
      const { data: profile } = await supabase.from('profiles').select('wp, wp_last_updated, character_mode').eq('id', userId).single()
      const elapsed = Date.now() - new Date(profile.wp_last_updated || Date.now()).getTime()
      const currentWP = calcWP(profile.wp ?? 0, profile.character_mode || 'play', Math.max(0, elapsed))
      if (currentWP <= 0) return NextResponse.json({ success: false, error: 'Cannot switch mode when WP is 0' })

      await supabase.from('profiles').update({
        character_mode: mode, wp: currentWP,
        wp_last_updated: new Date().toISOString(), mode_changed_at: new Date().toISOString(),
      }).eq('id', userId)

      return NextResponse.json({ success: true, mode, wp: currentWP })
    }

    if (action === 'switch_character') {
      const { characterId } = body
      const charData = await ensureCharacterData(supabase, userId, characterId)
      if (!charData?.is_unlocked) return NextResponse.json({ success: false, error: 'Character not unlocked' })

      const { data: curProfile } = await supabase.from('profiles').select('wp').eq('id', userId).single()
      await supabase.from('profiles').update({
        active_character_id: characterId, wp_last_updated: new Date().toISOString(),
      }).eq('id', userId)

      return NextResponse.json({ success: true, characterId, wp: curProfile?.wp || 0 })
    }

    if (action === 'switch_outfit') {
      const { outfitNum } = body
      const { data: profile } = await supabase.from('profiles').select('active_character_id').eq('id', userId).single()
      await supabase.from('character_data').update({ current_outfit: outfitNum }).eq('user_id', userId).eq('character_id', profile.active_character_id || 'char-1')
      return NextResponse.json({ success: true, outfit: outfitNum })
    }

    if (action === 'record_complete') {
      // EXP gained = wisdom_score from AI analysis (70-100)
      const { wisdomScore, durationSeconds } = body
      const expGained = wisdomScore || 78 // fallback to 78 if not provided

      const { data: profile } = await supabase.from('profiles').select('active_character_id').eq('id', userId).single()
      const charId = profile?.active_character_id || 'char-1'
      
      // Ensure character exists
      const charData = await ensureCharacterData(supabase, userId, charId)
      if (!charData) return NextResponse.json({ success: false, error: 'Failed to get/create character data' })

      const newTotalExp = (charData.total_exp || 0) + expGained
      const newRecSecs = (charData.total_recording_seconds || 0) + (durationSeconds || 0)
      const newCards = (charData.total_cards_created || 0) + 1
      const levelInfo = getLevelFromExp(newTotalExp)

      const outfitLevels = [1, 5, 10, 20, 30, 50]
      const unlocked = outfitLevels.filter(lv => levelInfo.level >= lv).map((_, i) => i + 1)

      const { error: updateErr } = await supabase.from('character_data').update({
        total_exp: newTotalExp,
        exp: levelInfo.currentExp,
        level: levelInfo.level,
        total_recording_seconds: newRecSecs,
        total_cards_created: newCards,
        unlocked_outfits: unlocked,
      }).eq('id', charData.id)

      if (updateErr) console.error('character_data update error:', updateErr)

      // Restore WP
      const { error: wpErr } = await supabase.from('profiles').update({
        wp: WP_MAX,
        wp_last_updated: new Date().toISOString(),
        last_recording_at: new Date().toISOString(),
      }).eq('id', userId)

      if (wpErr) console.error('profiles WP update error:', wpErr)

      return NextResponse.json({
        success: true,
        expGained,
        newTotalExp,
        levelInfo,
        unlockedOutfits: unlocked,
        wp: WP_MAX,
      })
    }

    if (action === 'init_character') {
      const { characterId, characterName } = body
      const { data: existing } = await supabase.from('character_data').select('id').eq('user_id', userId).eq('character_id', characterId).single()
      if (existing) {
        await supabase.from('character_data').update({ character_name: characterName, is_unlocked: true }).eq('id', existing.id)
      } else {
        await supabase.from('character_data').insert({
          user_id: userId, character_id: characterId, character_name: characterName,
          level: 1, exp: 0, total_exp: 0, current_outfit: 1, unlocked_outfits: [1], is_unlocked: true,
        })
      }
      await supabase.from('profiles').update({
        active_character_id: characterId,
        wp_last_updated: new Date().toISOString(), character_mode: 'play',
      }).eq('id', userId)
      return NextResponse.json({ success: true })
    }

    if (action === 'add_exp') {
      // Generic EXP addition (for default tasks, etc.)
      const amount = Math.min(Math.max(parseInt(body.amount) || 10, 1), 100) // clamp 1-100

      const { data: profile } = await supabase.from('profiles').select('active_character_id').eq('id', userId).single()
      const charId = profile?.active_character_id || 'char-1'
      const charData = await ensureCharacterData(supabase, userId, charId)
      if (!charData) return NextResponse.json({ success: false, error: 'Failed to get character data' })

      const newTotalExp = (charData.total_exp || 0) + amount
      const levelInfo = getLevelFromExp(newTotalExp)
      const outfitLevels = [1, 5, 10, 20, 30, 50]
      const unlocked = outfitLevels.filter(lv => levelInfo.level >= lv).map((_, i) => i + 1)

      await supabase.from('character_data').update({
        total_exp: newTotalExp,
        exp: levelInfo.currentExp,
        level: levelInfo.level,
        unlocked_outfits: unlocked,
      }).eq('id', charData.id)

      return NextResponse.json({ success: true, expGained: amount, newTotalExp, levelInfo, unlockedOutfits: unlocked })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('POST character-state error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
