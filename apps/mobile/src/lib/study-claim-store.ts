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

type ClaimState = { userId: string } | null;
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
export function requestStudyClaim(userId: string): void {
  if (_pending && _pending.userId === userId) return;
  _pending = { userId };
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
