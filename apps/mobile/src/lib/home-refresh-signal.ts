/**
 * Home tab refresh signal (Stage 5.WR.2, Bug 2 — third pass).
 *
 * A module-level event bus that lets any code path trigger a
 * "please refresh home tab data now" pulse, regardless of whether
 * the home tab's useFocusEffect would fire.
 *
 * Why this exists:
 *   expo-router v6 + react-native-screens models stacked modals such
 *   that a tab that's behind one or more modals does NOT receive a
 *   blur/focus event when those modals open or close. The home tab's
 *   useFocusEffect only fires on actual focus transitions (tab
 *   switches, app foreground after background, cold mount). It does
 *   NOT fire when a modal closes and reveals the home tab.
 *
 *   Concretely: after `router.replace(paywall)` swaps record→paywall
 *   and the user later closes the paywall, the home tab becomes
 *   visible again but its useFocusEffect callback never runs, so the
 *   cached character state that PhaseInsight's prefetch wrote earlier
 *   is never applied to the home UI.
 *
 *   The fix is an explicit signal: each modal-closing path that
 *   should refresh home data calls `emitHomeRefresh()`. The home tab
 *   subscribes once via `subscribeHomeRefresh()` and re-reads the
 *   cache (and optionally refetches) when it fires.
 *
 * Pattern mirrors skin-unlock-store (the existing global pub/sub
 * module-level store for cross-modal signals). Same shape, same
 * semantics — picked for consistency.
 *
 * Why not React Context: would force re-renders on every emit and
 * couples consumers to a Provider tree. A Set-of-callbacks is leaner
 * and matches the only-one-consumer reality (home tab is singleton).
 *
 * Why not EventEmitter (e.g., from 'events'): adds a runtime dep
 * for ~10 lines of state. The native Set works the same way for our
 * single-event use case.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
// Keep one coalesced pulse when Home is not mounted yet (notably a cold-start
// notification tap). A plain event emitter loses that signal before the tab
// subscribes, which leaves Home rendering its five-minute feed cache.
let pendingRefresh = false;

/**
 * Triggers all subscribers to refresh their home-tab data.
 * Called by record.tsx and subscription-paywall.tsx on close paths.
 */
export function emitHomeRefresh(): void {
  pendingRefresh = true;
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      // A buggy subscriber should not break the rest. Log and continue.
      console.warn('[home-refresh-signal] listener threw:', e);
    }
  }
}

/** Consume a refresh that arrived while Home was hidden or unmounted. */
export function consumeHomeRefresh(): boolean {
  const pending = pendingRefresh;
  pendingRefresh = false;
  return pending;
}

/**
 * Subscribes a callback to home-refresh emissions. Returns the
 * unsubscribe function. Typical usage:
 *
 *   useEffect(() => subscribeHomeRefresh(handleRefresh), [handleRefresh]);
 */
export function subscribeHomeRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
