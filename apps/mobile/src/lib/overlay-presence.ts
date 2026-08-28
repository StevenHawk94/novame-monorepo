import { useSyncExternalStore } from 'react';

// Ownership is per mounted surface, never per modal type. Closing one editor
// must not release another surface's reservation.
const owners = new Set<object>();
const listeners = new Set<() => void>();
export const isOverlayPresent = () => owners.size > 0;
export function subscribeOverlayPresence(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function registerOverlay(owner: object) {
  owners.add(owner);
  listeners.forEach(fn => fn());
  return () => {
    if (owners.delete(owner)) listeners.forEach(fn => fn());
  };
}
export function useOverlayPresent() {
  return useSyncExternalStore(subscribeOverlayPresence, isOverlayPresent, () => false);
}
