/** Never expose v2 visit data to installed clients expecting legacy gifting.
 * Raw questions, options, answers and rewards remain inside service-only RPCs. */
export function projectFriendVisitBootstrap(snapshot, optedIn) {
  if (snapshot?.friendVisitsVersion !== 2) return snapshot
  const { coupleFriendVisit, ...rest } = snapshot
  const projected = { ...rest, friendVisit: optedIn ? coupleFriendVisit || null : null }
  if (!optedIn) delete projected.friendVisitsVersion
  return projected
}
