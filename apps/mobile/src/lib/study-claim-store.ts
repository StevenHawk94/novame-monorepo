/**
 * Study-claim global store.
 *
 * Mirrors skin-unlock-store: a module-level pub/sub so the study-claim modal
 * can be rendered globally in (tabs)/_layout.tsx and coordinated by the modal
 * coordinator alongside announcement + skin. Replaces the previous approach
 * where use-study-claim-detector router.push'd a (modals) route page -- a
 * route page can't participate in the same serial Modal layer (RN <Modal>
 * always renders above a route), which caused priority inversion / stacking.
 *
 * State is just "is a claim pending, and for which user". The detector sets it
 * when (mode === 'study' && wp <= 0); the modal subscriber in tabs/_layout
 * renders <StudyClaimModal> when claim is the active coordinator slot, and
 * clears it on close.
 */

import { useEffect, useState } from 'react';

import type { StudyClaimResponse } from '@/lib/study-claim-api';

// `result` is the pre-settled study-claim payload when the claim was
// already POSTed before the modal mounts (e.g. on the splash gate before
// entering Home). When present, the modal renders it directly and skips
// its own postStudyClaim call. When absent (in-session detection /
// background return that wasn't pre-fetched), the modal self-fetches as
// before. Pre-settling is safe to not pre-fetch because study-claim is
// idempotent (it zeroes afk_study_seconds, so a second call settles 0).
type ClaimState = { userId: string; result?: StudyClaimResponse } | null;
type Listener = (state: ClaimState) => void;

let _pending: ClaimState = null;
const _listeners = new Set<Listener>();

function notify(): void {
  for (const l of _listeners) l(_pending);
}

/**
 * Mark a study-claim as pending for this user. Idempotent: re-requesting the
 * same user does not re-notify (avoids redundant renders from the detector's
 * cache + server double-trigger).
 */
export function requestStudyClaim(
  userId: string,
  result?: StudyClaimResponse,
): void {
  // Idempotent on userId, BUT if a result is now available and the
  // existing pending entry has none, upgrade it in place (the splash
  // gate may pre-settle slightly after the detector's cache-optimistic
  // request). Re-notify so the modal picks up the ready result.
  if (_pending && _pending.userId === userId) {
    if (result && !_pending.result) {
      _pending = { userId, result };
      notify();
    }
    return;
  }
  _pending = { userId, result };
  notify();
}

/**
 * Clear the pending claim (modal closed). Idempotent.
 */
export function clearStudyClaim(): void {
  if (_pending === null) return;
  _pending = null;
  notify();
}

// ---- Cold-start claim ownership ----
//
// The splash gate (app/index.tsx) is the single owner of the cold-start
// study-claim: it pre-settles the claim before entering Home so the modal
// shows instantly with no spinner. The in-session detector
// (use-study-claim-detector) must NOT also trigger a claim on its initial
// fetch, or the two would race and double-POST (the second POST settles 0
// because study-claim zeroes afk_study_seconds, which would flash "+0 XP").
//
// The gate sets this flag in its finally block (settled / nothing-to-claim
// / timeout / error -- always), and the detector checks it to skip exactly
// its one initial fetch. The detector's 30s in-session poll is unaffected:
// by the time it could fire, the gate has long since run.
let _coldStartClaimHandled = false;

export function markColdStartClaimHandled(): void {
  _coldStartClaimHandled = true;
}

export function wasColdStartClaimHandled(): boolean {
  return _coldStartClaimHandled;
}

// ---- External-claim ownership (background-resume overlay) ----
//
// Separate from the cold-start flag (which is one-shot and only gates the
// detector's INITIAL fetch). The background-resume overlay can run many
// times over an app's lifetime and overlaps the detector's 30s in-session
// poll, so it needs a resettable flag that the poll also honours. While
// true, the detector's poll skips triggering -- the overlay owns the claim
// for this resume and will POST exactly once via preSettleStudyClaim. The
// overlay sets it before settling and clears it when done (success, nothing
// to claim, error, or timeout), so the poll resumes as the normal fallback.
let _externalClaimInFlight = false;

export function beginExternalClaim(): void {
  _externalClaimInFlight = true;
}

export function endExternalClaim(): void {
  _externalClaimInFlight = false;
}

export function isExternalClaimInFlight(): boolean {
  return _externalClaimInFlight;
}

// ---- Deferred claim (network failure) ----
//
// When a claim POST fails with a NETWORK error (device offline / server
// unreachable), we do NOT show an error and do NOT auto-retry -- a sudden
// modal mid-recording would break the experience. The claim is "deferred":
// the in-session poll skips auto-popping it, and the Growth Study-Mode
// button surfaces a manual "Claim" (the session stays 'study' server-side,
// so the user can't start a new study anyway). It auto-pops on the next app
// open -- this in-memory flag resets on cold start.
let _claimDeferred = false;

export function setClaimDeferred(v: boolean): void {
  _claimDeferred = v;
}

export function isClaimDeferred(): boolean {
  return _claimDeferred;
}

/**
 * React hook: current pending claim state (or null). Re-renders the consumer
 * when it changes. Used by (tabs)/_layout.tsx.
 */
export function useStudyClaimPending(): ClaimState {
  const [state, setState] = useState<ClaimState>(_pending);
  useEffect(() => {
    _listeners.add(setState);
    setState(_pending);
    return () => {
      _listeners.delete(setState);
    };
  }, []);
  return state;
}
