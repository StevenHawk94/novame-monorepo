import { useSyncExternalStore } from 'react';
const transitions = new Set<string>();
const listeners = new Set<() => void>();
function update(target: string, started: boolean) {
  if (started) transitions.add(target); else transitions.delete(target);
  listeners.forEach(fn => fn());
}
export const ratingNavigationListeners = {
  transitionStart: (event: { target?: string }) => update(event.target || 'stack', true),
  transitionEnd: (event: { target?: string }) => update(event.target || 'stack', false),
};
export function useRatingTransitionBusy() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => transitions.size > 0, () => false);
}
