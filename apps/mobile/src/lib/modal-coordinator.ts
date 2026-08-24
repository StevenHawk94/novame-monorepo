import { useEffect, useState } from 'react';

/**
 * Global modal coordinator.
 *
 * Surfaces wanting to show a startup/foreground modal:
 *   - announcement popup (Home AnnouncementGate)
 *   - study-claim modal   (tabs/_layout, driven by study-claim-store)
 *   - skin-unlock modal   (tabs/_layout, driven by skin-unlock-store queue)
 *   - feature guide       (first-use walkthrough on a focused feature page)
 *
 * Serial, NON-PREEMPTIVE arbiter. Each surface REQUESTS a slot. At most one is
 * "active" (shown) at a time. KEY RULE: once a slot becomes active it is LOCKED
 * until it releases -- a later request, even higher priority, does NOT preempt
 * the visible modal. This is required because each surface is a native RN
 * <Modal>; swapping the active slot while one is on screen unmounts it
 * mid-flight (e.g. study-claim tearing down during its server call) and causes
 * native Modal transition glitches. Preemption was the bug behind "claim shows
 * its loading then vanishes when the announcement GET resolves late."
 *
 * Selection when NOTHING is active: among all currently-requested slots, pick
 * the highest PRIORITY (announcement > claim > skin). So priority still decides
 * order among slots ready at the same time; it just never interrupts a slot
 * already on screen. When the active slot releases, we re-select from whoever
 * is still requested.
 *
 * A short settle debounce coalesces the cold-start burst so that, when no modal
 * is active yet, near-simultaneous requests are compared together and the
 * highest-priority one is chosen first (rather than whoever happened to fire
 * the first millisecond earlier).
 *
 * Single global state (_active) + single timer; useActiveModalSlot is a pure
 * subscriber so every consumer always sees the same value.
 *
 * Callers: do the "shown" side effect (markRead / markSeen) only when actually
 * active + rendering, never at request time.
 */

export type ModalKind = 'announcement' | 'claim' | 'skin' | 'guide';

const PRIORITY: Record<ModalKind, number> = {
  announcement: 3,
  claim: 2,
  skin: 1,
  guide: 0,
};

const SETTLE_MS = 200;

type Listener = (active: ModalKind | undefined) => void;

const _requested = new Set<ModalKind>();
const _listeners = new Set<Listener>();

// The currently-shown slot (locked until it releases). undefined = none shown.
let _active: ModalKind | undefined = undefined;
let _settleTimer: ReturnType<typeof setTimeout> | null = null;

/** Highest-priority among currently-requested slots, or undefined if none. */
function highestRequested(): ModalKind | undefined {
  let best: ModalKind | undefined;
  for (const kind of _requested) {
    if (best === undefined || PRIORITY[kind] > PRIORITY[best]) best = kind;
  }
  return best;
}

function emit(): void {
  for (const l of _listeners) l(_active);
}

/**
 * Re-evaluate which slot should be active. NON-PREEMPTIVE: if a slot is already
 * active AND still requested, keep it (locked). Only when nothing is active (or
 * the active one was released) do we promote the highest-priority requester.
 * Debounced so the cold-start burst is compared together.
 */
function scheduleSettle(): void {
  if (_settleTimer) clearTimeout(_settleTimer);
  _settleTimer = setTimeout(() => {
    _settleTimer = null;

    // If the active slot is still requested, it stays locked -- no change.
    if (_active !== undefined && _requested.has(_active)) return;

    // Active slot is gone (released) or there was none: promote the best.
    const next = highestRequested();
    if (next === _active) return;
    _active = next;
    emit();
  }, SETTLE_MS);
}

/** Register that `kind` wants to show. Idempotent. */
export function requestModalSlot(kind: ModalKind): void {
  if (_requested.has(kind)) return;
  _requested.add(kind);
  scheduleSettle();
}

/**
 * Withdraw `kind`. Idempotent. If it was the active (shown) slot, immediately
 * clear active and re-settle so the next requester is promoted after the same
 * settle window (lets a near-simultaneous higher-priority pending win the next
 * turn deterministically).
 */
export function releaseModalSlot(kind: ModalKind): void {
  if (!_requested.has(kind)) return;
  _requested.delete(kind);
  if (_active === kind) {
    _active = undefined;
    emit(); // hide immediately; next slot promoted after settle
  }
  scheduleSettle();
}

/** Non-reactive read of the current active slot. */
export function peekActiveModalSlot(): ModalKind | undefined {
  return _active;
}

/**
 * React hook: subscribe to the active slot. Pure subscriber -- no per-hook
 * timer or snapshot, so all consumers always agree on _active.
 */
export function useActiveModalSlot(): ModalKind | undefined {
  const [active, setActive] = useState<ModalKind | undefined>(_active);
  useEffect(() => {
    _listeners.add(setActive);
    setActive(_active);
    return () => {
      _listeners.delete(setActive);
    };
  }, []);
  return active;
}
