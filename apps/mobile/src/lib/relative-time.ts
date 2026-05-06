/**
 * Relative-time formatter — Stage 3.9.A.2.4
 *
 * Formats a timestamp as a short relative string suitable for feed
 * rows: "now" / "3m" / "5h" / "2d" / "3w" / "4mo" / "2y".
 *
 * No third-party dependency. Mirrors the abbreviation style used in
 * social-app feeds.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeShort(input: string | number | Date): string {
  const ts =
    typeof input === 'string' || typeof input === 'number'
      ? new Date(input).getTime()
      : input.getTime();
  if (Number.isNaN(ts)) return '';

  const elapsed = Math.max(0, Date.now() - ts);
  if (elapsed < MIN) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MIN)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / WEEK)}w`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)}mo`;
  return `${Math.floor(elapsed / YEAR)}y`;
}
