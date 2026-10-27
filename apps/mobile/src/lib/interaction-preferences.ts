import { storage } from './storage';
import { kInteractionPreferences } from '../shared/storage/keys';

export type InteractionPreferences = { sound: boolean; haptics: boolean };
const listeners = new Set<() => void>();
function read(): InteractionPreferences {
  try {
    const value = JSON.parse(storage.getString(kInteractionPreferences.name) ?? '{}');
    return { sound: value.sound !== false, haptics: value.haptics !== false };
  } catch { return { sound: true, haptics: true }; }
}
let current = read();
export const getInteractionPreferences = () => current;
export const subscribeInteractionPreferences = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function setInteractionPreference(key: keyof InteractionPreferences, enabled: boolean) {
  const next = { ...current, [key]: enabled };
  storage.set(kInteractionPreferences.name, JSON.stringify(next));
  current = next;
  for (const fn of listeners) try { fn(); } catch { /* One observer cannot break the saved preference. */ }
}
