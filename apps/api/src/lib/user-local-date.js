/**
 * Reward/day boundaries must come from the immutable economic timezone, not
 * a caller supplied YYYY-MM-DD. Otherwise changing a device clock can reopen
 * daily rewards. The client date remains useful for display only.
 */
export function dateKeyInTimeZone(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now)
    const value = (type) => parts.find((part) => part.type === type)?.value
    return `${value('year')}-${value('month')}-${value('day')}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export async function resolveUserLocalDate(supabase, userId) {
  const { data, error } = await supabase.rpc('economic_calendar_v1', { p_user: userId })
  if (error) throw error
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data?.localDate || '')) throw new Error('economic_calendar_unavailable')
  return data.localDate
}
