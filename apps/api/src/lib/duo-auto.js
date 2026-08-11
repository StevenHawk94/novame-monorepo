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
 * If `ownerId` holds their OWN Plus and their paired partner is free,
 * seat the partner on the Duo plan. Safe to call repeatedly; every exit
 * path is a no-op. Never throws.
 */
export async function autoGrantDuoToPartner(supabase, ownerId) {
  try {
    // A seated member's Plus is borrowed — they can't grant it onward.
    const { data: seatedAsMember } = await supabase
      .from('duo_memberships')
      .select('id')
      .eq('member_id', ownerId)
      .eq('status', 'claimed')
      .maybeSingle()
    if (seatedAsMember) return

    const { data: me } = await supabase
      .from('profiles').select('subscription_tier').eq('id', ownerId).maybeSingle()
    if (me?.subscription_tier !== 'plus') return

    const { data: pairing } = await supabase
      .from('pairings').select('partner_user_id').eq('user_id', ownerId).maybeSingle()
    const partnerId = pairing?.partner_user_id
    if (!partnerId) return

    // Partner who bought their own Plus keeps it; the seat stays open.
    const { data: partner } = await supabase
      .from('profiles').select('subscription_tier').eq('id', partnerId).maybeSingle()
    if (!partner || partner.subscription_tier === 'plus') return

    // Owner's duo row: reuse, or create. A seat already claimed by a third
    // party (legacy invite code) is respected — nothing to grant.
    const { data: duo } = await supabase
      .from('duo_memberships')
      .select('id, member_id, status')
      .eq('owner_id', ownerId)
      .maybeSingle()
    if (duo?.member_id && duo.member_id !== partnerId) return

    const now = new Date().toISOString()
    if (duo) {
      const { error } = await supabase
        .from('duo_memberships')
        .update({ member_id: partnerId, status: 'claimed', claimed_at: now })
        .eq('id', duo.id)
      if (error) return
    } else {
      const { error } = await supabase
        .from('duo_memberships')
        .insert({ owner_id: ownerId, member_id: partnerId, status: 'claimed', claimed_at: now, invite_code: autoCode() })
      if (error) return
    }

    await supabase
      .from('profiles')
      .update({ subscription_tier: 'plus', updated_at: now })
      .eq('id', partnerId)
    console.log(`[duo-auto] granted Plus to partner ${partnerId} of owner ${ownerId}`)
  } catch (err) {
    console.warn('[duo-auto] grant failed (non-fatal):', err && err.message)
  }
}

/** Both directions of a fresh pairing — whichever side owns Plus grants. */
export async function autoGrantDuoBothWays(supabase, aId, bId) {
  await autoGrantDuoToPartner(supabase, aId)
  await autoGrantDuoToPartner(supabase, bId)
}

/**
 * Pairing dissolved between `aId` and `bId`: release any seat granted
 * between them and revoke the member's borrowed Plus — unless the member
 * has since bought their own subscription. Never throws.
 */
export async function revokeDuoOnUnpair(supabase, aId, bId) {
  try {
    const { data: rows } = await supabase
      .from('duo_memberships')
      .select('id, owner_id, member_id')
      .eq('status', 'claimed')
      .or(`and(owner_id.eq.${aId},member_id.eq.${bId}),and(owner_id.eq.${bId},member_id.eq.${aId})`)
    const duo = rows?.[0]
    if (!duo) return

    const now = new Date().toISOString()
    await supabase
      .from('duo_memberships')
      .update({ member_id: null, status: 'pending', claimed_at: null })
      .eq('id', duo.id)

    // Member keeps Plus only if they own an active subscription themselves.
    const { data: ownSub } = await supabase
      .from('subscriptions')
      .select('current_period_end, status')
      .eq('user_id', duo.member_id)
      .maybeSingle()
    const ownActive = ownSub?.current_period_end
      && new Date(ownSub.current_period_end).getTime() > Date.now()
    if (!ownActive) {
      await supabase
        .from('profiles')
        .update({ subscription_tier: 'free', updated_at: now })
        .eq('id', duo.member_id)
    }
    console.log(`[duo-auto] released seat of owner ${duo.owner_id} on unpair`)
  } catch (err) {
    console.warn('[duo-auto] revoke failed (non-fatal):', err && err.message)
  }
}

function autoCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return code
}
