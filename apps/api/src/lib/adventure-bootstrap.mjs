/** Optional during a staggered API/database rollout. Never fabricate a plan. */
export async function readAdventureDisplay(db, userId, adventureId) {
  const result = await db.rpc('adventure_display_v1', { p_user_id: userId, p_adventure_id: adventureId })
  if (result.error && ['PGRST202', '42883'].includes(result.error.code)) return null
  if (result.error) throw result.error
  return result.data
}

/** Recover the complete frozen plan before presenting an arrival. This also
 * settles due solo journeys, whose bootstrap is assembled outside SQL. */
export async function settleBootstrapAdventure(db, userId, snapshot, now = Date.now()) {
  const active = snapshot?.activeAdventure
  if (!snapshot || snapshot.error || !active) return snapshot
  if (active.status === 'in_progress' && Date.parse(active.ends_at) > now) {
    const display = await readAdventureDisplay(db, userId, active.id)
    if (display?.error) return { error: display.error }
    return display ? { ...snapshot, activeAdventure: display.activeAdventure,
      adventureResult: display.adventureResult, adventurePlan: display.adventurePlan } : snapshot
  }
  if (!(
    (snapshot.adventureResult && !snapshot.adventureResult.metadata?.encounterV2)
    || (active.status === 'in_progress' && Date.parse(active.ends_at) <= now))) return snapshot
  const settled = await db.rpc('adventure_command_v2', { p_user_id: userId, p_adventure_id: active.id, p_action: 'settle' })
  if (settled.error) throw settled.error
  if (settled.data?.error) return { error: settled.data.error }
  const [journey, result] = await Promise.all([
    db.from('adventures').select('*').eq('id', active.id).eq('user_id', userId).single(),
    db.from('adventure_results').select('*').eq('adventure_id', active.id).maybeSingle(),
  ])
  if (journey.error) throw journey.error
  if (result.error) throw result.error
  return { ...snapshot, activeAdventure: journey.data, adventureResult: result.data }
}
