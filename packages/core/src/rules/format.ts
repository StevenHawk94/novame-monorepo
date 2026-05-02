/**
 * @novame/core/rules/format
 *
 * Time formatting helpers used across admin (book-orders / wisdoms duration
 * display) and mobile (timer UI).
 *
 * Behavior preserved 1:1 from apps/api/src/lib/constants.js.
 */

/** Format a minute count as 'Xh Ym' / 'Xh' / 'Xm Ys' / 'Xm'. */
export function formatMinutes(totalMins: number): string {
  if (totalMins >= 60) {
    const h = Math.floor(totalMins / 60)
    const m = Math.round(totalMins % 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const m = Math.floor(totalMins)
  const s = Math.round((totalMins - m) * 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

/** Format a second count by delegating to formatMinutes(secs / 60). */
export function formatSeconds(totalSecs: number): string {
  return formatMinutes(totalSecs / 60)
}
