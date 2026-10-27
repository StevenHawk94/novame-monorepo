/** A failed supplementary read must not turn a committed reward into a failure. */
export async function readRewardWallet(db, userId, signal) {
  try {
    const query = db.rpc('burrow_reward_wallet_state_v1', { p_user_id: userId })
    const { data, error } = await (typeof query.abortSignal === 'function'
      ? query.abortSignal(signal ?? AbortSignal.timeout(1200)) : query)
    if (error || !data?.wallet || !Array.isArray(data.credits)) return null
    return data
  } catch { return null }
}

export async function withRewardWallet(db, userId, result, source = {}) {
  if (!result || result.error) return result
  const coinState = await readRewardWallet(db, userId)
  if (!coinState) return result
  const day = source.localDate || coinState.localDate
  const key = result.coinReward?.key ?? (source.action === 'claim_daily_quest' ? `daily-quest:${source.assignmentId}`
    : source.action === 'claim_special_quest' ? `special:${source.questId}:${source.stage}`
    : source.action === 'complete_affection' ? `affection-first:${day}`
    : source.action === 'refill_room_need' ? `room-need-reward:${source.need}:${day}`
    : source.action === 'record' ? `record-first:${day}`
    : source.action === 'rage' ? `rage-first:${result.localDate || day}` : null)
  const amount = Math.max(0, Number(result.reward ?? result.carrotsAwarded ?? 0) || 0)
  return { ...result, coinState, ...(key ? { coinReward: { key, amount } } : {}) }
}
