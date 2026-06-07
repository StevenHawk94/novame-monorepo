import { WP_MAX } from '@/lib/constants'

export { WP_MAX }

/**
 * Ensure a character_data row exists for this user+character.
 * Auto-creates a default row if missing. Returns the row (or null on
 * create failure). Shared by character-state and publish-wisdom.
 */
export async function ensureCharacterData(supabase, userId, characterId) {
  const { data } = await supabase
    .from('character_data')
    .select('*')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .single()

  if (data) return data

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
  if (error) console.error('[character] auto-create character_data error:', error)
  return created
}

/**
 * Restore WP to full and (optionally) increment recording stats.
 *
 * This is the single authoritative side effect of a SUCCESSFUL wisdom
 * publish: WP back to 100 + bump last_recording_at (drives the Home
 * hungry -> chill character video swap), and the card/recording counters.
 *
 * Called from publish-wisdom right after a card is successfully created,
 * so it is bound atomically to "transform succeeded" and does NOT depend
 * on the client firing a separate request. Best-effort: failures are
 * logged but never thrown (the wisdom + card are already saved).
 *
 * @param {object} opts
 * @param {boolean} opts.countCard  whether to increment total_cards_created
 *                                   (+ total_recording_seconds). publish-wisdom
 *                                   passes true; the legacy record_complete
 *                                   action passes false to avoid double-count
 *                                   during the client rollout (WP-only).
 */
export async function restoreWpOnPublish(supabase, userId, { durationSeconds = 0, countCard = true } = {}) {
  const nowIso = new Date().toISOString()

  // WP restore (always) — the Home hungry->chill trigger.
  const { error: wpErr } = await supabase
    .from('profiles')
    .update({ wp: WP_MAX, wp_last_updated: nowIso, last_recording_at: nowIso })
    .eq('id', userId)
  if (wpErr) console.error('[character] WP restore failed:', wpErr.message)

  // Card / recording counters (optional, to avoid double-count in rollout).
  if (countCard) {
    try {
      const { data: profile } = await supabase
        .from('profiles').select('active_character_id').eq('id', userId).single()
      const charId = profile?.active_character_id || 'char-1'
      const charData = await ensureCharacterData(supabase, userId, charId)
      if (charData) {
        const newRecSecs = (charData.total_recording_seconds || 0) + (durationSeconds || 0)
        const newCards = (charData.total_cards_created || 0) + 1
        const { error: cdErr } = await supabase
          .from('character_data')
          .update({ total_recording_seconds: newRecSecs, total_cards_created: newCards })
          .eq('id', charData.id)
        if (cdErr) console.error('[character] counter update failed:', cdErr.message)
      }
    } catch (e) {
      console.error('[character] counter update exception:', e && e.message)
    }
  }
}
