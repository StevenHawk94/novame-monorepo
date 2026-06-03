/**
 * "Known quota-exhausted" flag for the record/publish flow.
 *
 * Purpose: let Transform make an INSTANT local decision instead of waiting
 * on a network round-trip. The publish-wisdom server is the authoritative
 * quota gate (returns 402 QUOTA_EXCEEDED when over), but for the common
 * single-device case "I just used my last insight, now I tap Transform
 * again" we can decide locally and pop the paywall with zero latency.
 *
 * Design (deliberately NOT a local counter — counters drift vs the server's
 * lifetime/billing-cycle windows):
 *   - The flag is a pure CACHE of the server's last verdict. It is set true
 *     ONLY when a publish response says quotaExhausted=true ("that was your
 *     last one"), and cleared when the server says quotaExhausted=false
 *     ("you still have room") or when a purchase upgrades the tier.
 *   - Transform reads the flag: true -> pop paywall instantly (no request);
 *     false/unset -> proceed to PUBLISHING and let the server 402 cover the
 *     cross-device / reinstall / drift cases.
 *
 * So the flag never decides quota by itself — it only remembers what the
 * server last said, and the server 402 remains the correctness backstop.
 */
import { storage } from './storage';

const KEY = 'novame_quota_exhausted';

/** True if the server's last verdict was "you're out of quota". */
export function isQuotaKnownExhausted(): boolean {
  return storage.getBoolean(KEY) ?? false;
}

/**
 * Record the server's quota verdict from a publish response.
 * quotaExhausted=true  -> remember "out" (next Transform pops paywall fast).
 * quotaExhausted=false -> clear (there is still room).
 */
export function setQuotaExhausted(exhausted: boolean): void {
  if (exhausted) storage.set(KEY, true);
  else storage.remove(KEY);
}

/** Clear the flag (e.g. after a purchase upgrades the tier / new period). */
export function clearQuotaExhausted(): void {
  storage.remove(KEY);
}
