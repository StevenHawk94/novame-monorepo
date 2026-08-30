/**
 * Reward/day boundaries must come from the server-owned profile timezone, not
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
  const { data, error } = await supabase.from('profiles')
    .select('timezone_name').eq('id', userId).maybeSingle()
  if (error) throw error
  return dateKeyInTimeZone(data?.timezone_name)
}
