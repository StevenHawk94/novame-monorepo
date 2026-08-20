/**
 * Automatic Duo seating for paired partners (2026-08-11 ruling).
 *
 * "One subscription, two people" is now literal for the paired couple:
 *   - when a user's own Plus activates (purchase or renewal), their paired
 *     partner is auto-seated on the Duo plan if the partner is free;
 *   - when a pairing forms, the same grant runs in both directions;
 *   - when a pairing dissolves, the granted seat is released and the
 *     member's Plus is revoked (unless they since bought their own).
 *
 * The manual invite-code entry is retired; legacy code-claimed seats keep
 * working (the owner-expiry lapse in the webhooks covers them too).
 */

/**
 * Reconcile the effective entitlement of an owner and their paired partner.
 * The database RPC holds both user locks and changes the seat + profile tiers
 * in one transaction. Callers deliberately receive failures so pairing and
 * payment routes cannot report success after a silent partial grant.
 */
export async function autoGrantDuoToPartner(supabase, ownerId) {
  const { data: pairing, error: pairingError } = await supabase
    .from('pairings')
    .select('partner_user_id')
    .eq('user_id', ownerId)
    .maybeSingle()
  if (pairingError) throw new Error(`pair lookup failed: ${pairingError.message}`)
  if (!pairing?.partner_user_id) return { success: true, paired: false }
  return autoGrantDuoBothWays(supabase, ownerId, pairing.partner_user_id)
}

/** Both directions of a fresh pairing — whichever side owns Plus grants. */
export async function autoGrantDuoBothWays(supabase, aId, bId) {
  const { data, error } = await supabase.rpc('sync_pair_plus_entitlements', {
    p_user_a: aId,
    p_user_b: bId,
  })
  if (error) throw new Error(`pair entitlement sync failed: ${error.message}`)
  if (!data?.success) throw new Error(`pair entitlement sync failed: ${data?.error || 'unknown'}`)
  return data
}

/**
 * Pairing dissolved between `aId` and `bId`: release any seat granted
 * between them and recompute both users from independently owned purchases.
 */
export async function revokeDuoOnUnpair(supabase, aId, bId) {
  const { data, error } = await supabase.rpc('release_pair_plus_entitlements', {
    p_user_a: aId,
    p_user_b: bId,
  })
  if (error) throw new Error(`pair entitlement release failed: ${error.message}`)
  if (!data?.success) throw new Error(`pair entitlement release failed: ${data?.error || 'unknown'}`)
  return data
}
