import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getExpNeeded, getLevelFromExp } from '@/lib/exp'
import { restoreWpOnPublish } from '@/lib/character'

export const runtime = 'edge'

const WP_MAX = 100
const WP_STUDY_DECAY = 10
const WP_PLAY_DECAY = 5
const WP_HUNGER = 40
// EXP is now based on wisdom_score (70-100) per wisdom created

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}



function calcWP(wpStart, mode, elapsedMs) {
  if (!wpStart || wpStart <= 0) return 0
  const hrs = elapsedMs / 3600000
  const rate = mode === 'study' ? WP_STUDY_DECAY : WP_PLAY_DECAY
  return Math.max(0, Math.round(wpStart - hrs * rate))
}

function calcAFKExp(mode, wp, accumSecs, newSecs) {
  // XP accrues only while WP > 0 (WP === 0 means hungry: no earning).
  // No hunger-threshold tiering -- a single rate per mode:
  //   study: 10 xp/hr, play (chill): 2 xp/hr.
  if (wp <= 0) return { exp: 0, remain: accumSecs + newSecs }
  const total = accumSecs + newSecs
  // secsPerExp = 3600 / (xp per hour)
  const secsPerExp = mode === 'study' ? 3600 / 10 : 3600 / 2
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

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[character-state GET] rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[character-state GET] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[character-state GET] rejected: token user', _authUser.id, '!= userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabase()

    // Ensure profile has character fields
    const profileBase = await ensureProfileFields(supabase, userId)
    if (!profileBase) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Re-read full profile.
    // ai_consent_at is included here so the mobile client can read it
    // from the character-state response without making a separate
    // /api/ai-consent GET call. The field is set when the user
    // agrees to AI processing via the in-app consent modal.
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_character_id, character_mode, wp, wp_last_updated, mode_changed_at, afk_study_seconds, afk_play_seconds, last_recording_at, ai_consent_at')
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

    // Only count time while WP is actually > 0. WP decays at a fixed
    // rate, so cap the counted window at the moment WP would hit 0
    // (startWp / rate hours). Without this cap, a long elapsed gap after
    // WP already drained to 0 would over-credit time (and XP).
    const decayRate = mode === 'study' ? WP_STUDY_DECAY : WP_PLAY_DECAY
    const startWp = profile.wp ?? 0
    const secsUntilEmpty = startWp > 0 ? Math.floor((startWp / decayRate) * 3600) : 0
    const effectiveSecs = Math.min(elapsedSecs, secsUntilEmpty)

    // EXP accrual differs by mode:
    //   - study: do NOT convert to XP here. Accumulate the WP>0 seconds
    //     into afk_study_seconds and let study-claim settle the whole
    //     session in one go (floor(seconds / 360) = 1 XP per 360s) when
    //     WP reaches 0. So the Growth bar does not move during study; it
    //     jumps once at claim. WP can be refilled mid-session by
    //     publishing, and the counter simply keeps accumulating.
    //   - play (chill): convert in real time at 2 xp/hr, same as before.
    let afkExp = 0
    let afkRemain
    if (mode === 'study') {
      afkRemain = (profile.afk_study_seconds || 0) + effectiveSecs
    } else {
      const afk = startWp > 0
        ? calcAFKExp(mode, currentWP, profile.afk_play_seconds || 0, effectiveSecs)
        : { exp: 0, remain: (profile.afk_play_seconds || 0) + effectiveSecs }
      afkExp = afk.exp
      afkRemain = afk.remain
    }

    // The level/progress the client sees. study earns are deferred to
    // claim, so during study this is just the persisted total_exp (bar
    // stays put). play folds in any real-time earn.
    const totalExp = (charData?.total_exp || 0) + afkExp
    const levelInfo = getLevelFromExp(totalExp)

    // Write back
    const counterChanged = mode === 'study' && effectiveSecs > 0
    if (afkExp > 0 || currentWP !== (profile.wp ?? 0) || counterChanged) {
      await supabase.from('profiles').update({
        wp: currentWP,
        wp_last_updated: new Date(now).toISOString(),
        [mode === 'study' ? 'afk_study_seconds' : 'afk_play_seconds']: afkRemain,
      }).eq('id', userId)

      if (afkExp > 0 && charData) {
        await supabase.from('character_data').update({
          total_exp: totalExp, exp: levelInfo.currentExp, level: levelInfo.level,
        }).eq('id', charData.id)
      }
    }

    const { data: allChars } = await supabase.from('character_data').select('*').eq('user_id', userId).order('character_id')

    // Skin-unlock "seen" set (DB-authoritative). Mobile computes which
    // outfit-unlock modals to show as getUnlockedOutfits(level) - seen - {1}.
    // Replaces the old MMKV-only tracker that re-fired on every re-login.
    const { data: seenRows } = await supabase
      .from('user_seen_skin_unlocks')
      .select('outfit_num')
      .eq('user_id', userId)
    const seenSkinUnlocks = (seenRows || []).map(r => r.outfit_num)

    return NextResponse.json({
      success: true,
      activeCharacterId: charId,
      mode,
      wp: currentWP,
      character: charData ? { ...charData, total_exp: totalExp, exp: levelInfo.currentExp, level: levelInfo.level } : null,
      levelInfo,
      allCharacters: allChars || [],
      aiConsentAt: profile.ai_consent_at ?? null,
      seenSkinUnlocks,
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

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[character-state POST] rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[character-state POST] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[character-state POST] rejected: token user', _authUser.id, '!= userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
        // Entering study starts a fresh claim cycle: reset the WP>0
        // second counter so the previous session's leftover never bleeds
        // into the new one. (Leaving study -> play does not touch it; the
        // claim flow zeroes it on settle.)
        ...(mode === 'study' ? { afk_study_seconds: 0 } : {}),
      }).eq('id', userId)

      return NextResponse.json({ success: true, mode, wp: currentWP })
    }

    if (action === 'switch_character') {
      const { characterId } = body
      const charData = await ensureCharacterData(supabase, userId, characterId)
      if (!charData?.is_unlocked) return NextResponse.json({ success: false, error: 'Character not unlocked' })

      const { data: curProfile } = await supabase.from('profiles').select('wp').eq('id', userId).single()
      // C3: do NOT reset wp_last_updated on character switch. WP lives on
      // profiles (per-user, not per-character), so the decay clock must keep
      // running across a switch. Resetting it to now refunded all elapsed
      // decay (free WP); leaving it untouched lets the next character-state
      // GET compute the correct elapsed decay from the original baseline.
      await supabase.from('profiles').update({
        active_character_id: characterId,
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
      // WP-only now. The authoritative WP restore AND the card/recording
      // counters moved into publish-wisdom, bound atomically to a
      // successfully created card (see restoreWpOnPublish). That removes
      // the old failure mode where a client timeout / network error after
      // a successful server publish skipped this request, leaving Home
      // stuck on the hungry video.
      //
      // This legacy action is kept as a WP-only, idempotent no-harm path:
      // older clients still calling it during the app rollout only
      // re-affirm WP=100 and bump last_recording_at; they do NOT increment
      // total_cards_created again (publish-wisdom already did), so there is
      // no double-count. New clients stop calling it entirely.
      await restoreWpOnPublish(supabase, userId, { countCard: false })
      return NextResponse.json({ success: true, wp: WP_MAX })
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

    // C2: removed the 'add_exp' action -- a client-callable endpoint that
    // added arbitrary EXP (clamped 1-100) straight to the caller's own
    // character. It had ZERO callers anywhere in the repo, so it was dead
    // code AND a latent self-award / leaderboard-inflation surface
    // (rank = character_data.total_exp). Dropped per the audit's
    // delete-orphan-routes principle. EXP is awarded only via legitimate
    // flows (study-claim, daily-tasks completion, publish quests).

    if (action === 'mark_skin_seen') {
      // Record that the user has been shown the unlock modal for this outfit,
      // so it never re-fires (survives re-login / cache clear). Upsert =
      // idempotent; outfit 1 is the default skin and should never be sent.
      const outfitNum = parseInt(body.outfitNum, 10)
      if (!Number.isInteger(outfitNum) || outfitNum < 2 || outfitNum > 6) {
        return NextResponse.json({ error: 'Invalid outfitNum' }, { status: 400 })
      }
      const { error: seenErr } = await supabase
        .from('user_seen_skin_unlocks')
        .upsert({ user_id: userId, outfit_num: outfitNum }, { onConflict: 'user_id,outfit_num' })
      if (seenErr) return NextResponse.json({ error: seenErr.message }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('POST character-state error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
