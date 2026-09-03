export const PAIRING_INVITATION_TTL_MS = 48 * 60 * 60 * 1000

export function pairingInvitationExpiresAt(createdAt) {
  return new Date(new Date(createdAt).getTime() + PAIRING_INVITATION_TTL_MS).toISOString()
}

/**
 * Remove pending invitations that have reached their 48-hour lifetime.
 *
 * A re-invite reuses a historical accepted friendship row, so expiry restores
 * that history marker. A first-time invitation has no history and is deleted.
 * The service-role client is required; callers authenticate the affected user
 * before invoking this helper.
 */
export async function expirePairingInvitations(supabase, userId) {
  const cutoff = new Date(Date.now() - PAIRING_INVITATION_TTL_MS).toISOString()
  const { data: expired, error: readError } = await supabase
    .from('friendships')
    .select('id, accepted_at')
    .eq('status', 'pending')
    .lte('created_at', cutoff)
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
  if (readError) throw readError
  if (!expired?.length) return 0

  const historicalIds = expired.filter((row) => row.accepted_at).map((row) => row.id)
  const newIds = expired.filter((row) => !row.accepted_at).map((row) => row.id)

  if (historicalIds.length > 0) {
    const { error } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .in('id', historicalIds)
      .eq('status', 'pending')
      .lte('created_at', cutoff)
    if (error) throw error
  }
  if (newIds.length > 0) {
    const { error } = await supabase
      .from('friendships')
      .delete()
      .in('id', newIds)
      .eq('status', 'pending')
      .lte('created_at', cutoff)
    if (error) throw error
  }

  return expired.length
}
