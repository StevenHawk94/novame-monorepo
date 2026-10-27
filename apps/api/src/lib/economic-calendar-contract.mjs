/** No extra network read. The authoritative bootstrap owns this calendar. */
export function projectEconomicCalendar(snapshot, request) {
  if (!snapshot || snapshot.error) return snapshot
  if (typeof snapshot.economicTimezone !== 'string' || !snapshot.economicTimezone) throw new Error('economic_calendar_unavailable')
  if (request.headers?.get?.('x-burrow-economy') === '1') return snapshot
  // Older clients use profile.timezone_name for daily eligibility. Project the
  // fixed zone for their display only; never mutate the actual profile. Current
  // clients retain the real profile timezone for Home art/local display.
  return { ...snapshot, profile: { ...snapshot.profile, timezone_name: snapshot.economicTimezone } }
}
