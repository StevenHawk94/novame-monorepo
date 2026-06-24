/**
 * preSettleStudyClaim — shared cold-start / background-resume study-claim
 * settler (Stage: splash-claim Step 1 + Step 2).
 *
 * Both the splash gate (app/index.tsx, cold start) and the background-
 * resume overlay (long background return) need the exact same sequence:
 * fetch the real character-state, and if a study session has ended
 * (mode === 'study' && wp<=0), POST the claim and stash the result in the
 * study-claim-store so the modal renders the result directly (no spinner).
 *
 * This is the single source of that sequence so the two callers can't
 * drift apart.
 *
 * Ownership ordering (critical, mirrors the cold-start design):
 *   1. onClaimOwned() is invoked BEFORE postStudyClaim. The caller uses it
 *      to mark ownership (cold start: markColdStartClaimHandled; resume:
 *      beginExternalClaim) so the in-session detector skips/yields and can
 *      never race a second POST against the about-to-be-zeroed counter
 *      (which would flash "+0 XP").
 *   2. The result is written via requestStudyClaim WITHOUT a cancelled
 *      guard: study-claim-store is module-level and outlives the caller's
 *      component, so a slow POST that finishes after the caller unmounted
 *      still surfaces the modal instead of losing the claim.
 *
 * isCancelled() is checked AFTER the fetch but BEFORE the POST. This
 * preserves the cold-start timeout semantics: if the gate already timed
 * out and entered Home (caller unmounted) while we were still fetching, we
 * must NOT then POST — the counter is untouched, so we bail and let the
 * in-session detector settle it normally (no double-settle, no "+0").
 * Once the POST has started, however, we always finish and stash (rule 2).
 *
 * Returns true iff a claim was POSTed (and stashed).
 */
import {
  applyLocalWPDecay,
  fetchCharacterState,
} from '@/lib/character-state';
import { postStudyClaim } from '@/lib/study-claim-api';
import { requestStudyClaim } from '@/lib/study-claim-store';

type PreSettleOpts = {
  /** Invoked right before the POST so the caller can claim ownership. */
  onClaimOwned?: () => void;
  /**
   * Checked after the fetch, before the POST. Return true to abort without
   * POSTing (the caller has already given up / entered Home). The counter
   * is untouched in that case, so a fallback path can settle later.
   */
  isCancelled?: () => boolean;
};

export async function preSettleStudyClaim(
  userId: string,
  opts: PreSettleOpts = {},
): Promise<boolean> {
  const fresh = await fetchCharacterState(userId);
  if (opts.isCancelled?.()) return false;

  const wpNow = applyLocalWPDecay(fresh.wp, fresh.mode, fresh.wpLastFetchedAtMs);
  if (fresh.mode === 'study' && wpNow <= 0) {
    opts.onClaimOwned?.();
    const result = await postStudyClaim(userId);
    // No-op claim (already settled / nothing banked): don't stash, so the
    // cold-start / resume path never mounts a blank "+0 XP" modal. Ownership
    // was marked above, so the in-session detector won't re-fire either.
    if (result?.nothingToClaim) return false;
    requestStudyClaim(userId, result);
    return true;
  }
  return false;
}
