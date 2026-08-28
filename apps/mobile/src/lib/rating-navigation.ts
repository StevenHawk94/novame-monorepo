import { useSyncExternalStore } from 'react';

type TransitionEvent = { target?: string; data: { closing: boolean } };
type StackNavigation = { getState(): { index: number; routes: readonly { key: string }[] } };

let nativeTransitionTarget: string | null = null;
let pendingExitRoute: string | null = null;
const listeners = new Set<() => void>();
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
// Native transitions normally finish in 250–500ms. A missing callback must
// never become a permanent application lock. This is recovery, not a delay
// added to normal navigation or post-Reflect prompts.
function armRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    console.warn('[navigation] recovered an interrupted transition');
    resetNavigationTransitions();
  }, 1200);
}

function notify() {
  listeners.forEach(fn => fn());
}

export function resetNavigationTransitions() {
  clearTimeout(recoveryTimer);
  recoveryTimer = undefined;
  nativeTransitionTarget = null;
  pendingExitRoute = null;
  notify();
}

// Programmatic pop removes the outgoing route from state.routes before its
// native onDisappear. React Navigation then drops that route's screenListeners
// events. Wait for the LIVE destination's onAppear, never for the removed key.
export function ratingNavigationListeners({ navigation }: { navigation: StackNavigation }) {
  const isFocused = (target?: string) => {
    const state = navigation.getState();
    return target !== undefined && target === state.routes[state.index]?.key;
  };
  return {
    transitionStart: (event: TransitionEvent) => {
      // Background disappear callbacks may arrive after the destination appears.
      // They must not recreate a lock, nor may an old opening event do so.
      if (!isFocused(event.target)) return;
      nativeTransitionTarget = event.target!;
      armRecovery();
      notify();
    },
    transitionEnd: (event: TransitionEvent) => {
      if ((!event.data.closing && isFocused(event.target))
        || (event.data.closing && event.target === nativeTransitionTarget)) resetNavigationTransitions();
    },
    gestureCancel: (event: { target?: string }) => {
      if (isFocused(event.target)) resetNavigationTransitions();
    },
  };
}

// Bridge router.back -> native transitionStart for PROMPTS only. Home's tap
// guard observes actual native transitions, not this promotional queue intent.
export function markNavigationTransitionPending(routeKey: string) {
  pendingExitRoute = routeKey;
  armRecovery();
  notify();
}
export const isNativeNavigationTransitionBusy = () => nativeTransitionTarget !== null;
export const isNavigationTransitionBusy = () => pendingExitRoute !== null || isNativeNavigationTransitionBusy();
export function subscribeNavigationTransitions(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}
export function useRatingTransitionBusy() {
  return useSyncExternalStore(subscribeNavigationTransitions, isNavigationTransitionBusy, () => false);
}
