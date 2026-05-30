import { useEffect, useState } from 'react';

/**
 * Global modal coordinator.
 *
 * Several independent surfaces want to show a startup/foreground modal:
 *   - announcement popup (Home AnnouncementGate)
 *   - study-claim modal   (route pushed by use-study-claim-detector)
 *   - skin-unlock modal   (tabs/_layout, driven by skin-unlock-store queue)
 *
 * Without coordination they stack/race (two RN <Modal>s, plus a route page),
 * producing z-index fights and priority inversion. This module is the single
 * arbiter: each surface REQUESTS a slot; only the highest-priority active
 * requester is told it may show; the others wait. When the active one releases
 * (closes), the next-highest becomes active. Strictly serial -- at most one
 * modal is shown at a time.
 *
 * Priority (higher wins): announcement > claim > skin.
 *
 * Pattern mirrors skin-unlock-store: a module-level pub/sub, NO React Context
 * (so requesting/releasing never re-renders unrelated trees; only subscribers
 * via useActiveModalSlot re-render).
 *
 * IMPORTANT for callers: only perform the "shown" side effect (announcement
 * markRead, skin markSeen) when you are actually ACTIVE and rendering -- not
 * at request time -- so a modal that is queued-but-hidden is not marked seen.
 */

export type ModalKind = 'announcement' | 'claim' | 'skin';

const PRIORITY: Record<ModalKind, number> = {
  announcement: 3,
  claim: 2,
  skin: 1,
};

type Listener = (active: ModalKind | undefined) => void;

const _requested = new Set<ModalKind>();
const _listeners = new Set<Listener>();

/** Highest-priority currently-requested kind, or undefined if none. */
function computeActive(): ModalKind | undefined {
  let best: ModalKind | undefined;
  for (const kind of _requested) {
    if (best === undefined || PRIORITY[kind] > PRIORITY[best]) {
      best = kind;
    }
  }
  return best;
}

function notify(): void {
  const active = computeActive();
  for (const l of _listeners) l(active);
}

/**
 * Register that `kind` wants to show. Idempotent. Recomputes the active slot
 * and notifies subscribers. Call when the surface has content ready to show.
 */
export function requestModalSlot(kind: ModalKind): void {
  if (_requested.has(kind)) return;
  _requested.add(kind);
  notify();
}

/**
 * Withdraw `kind` (it closed or no longer has content). Idempotent. The next-
 * highest requester (if any) becomes active.
 */
export function releaseModalSlot(kind: ModalKind): void {
  if (!_requested.has(kind)) return;
  _requested.delete(kind);
  notify();
}

/** Non-reactive read of the current active slot (for imperative call sites). */
export function peekActiveModalSlot(): ModalKind | undefined {
  return computeActive();
}

/**
 * React hook: subscribe to the active slot. Re-renders the consumer whenever
 * the highest-priority requested kind changes. A surface shows its modal iff
 * useActiveModalSlot() === its own kind (AND it has requested).
 */
export function useActiveModalSlot(): ModalKind | undefined {
  const [active, setActive] = useState<ModalKind | undefined>(computeActive());
  useEffect(() => {
    _listeners.add(setActive);
    // Sync once on mount in case state changed between initial render and effect.
    setActive(computeActive());
    return () => {
      _listeners.delete(setActive);
    };
  }, []);
  return active;
}
