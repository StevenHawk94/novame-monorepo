import { kNewLensState, kQuietWinsState, kTameEnemyState, kTameStatus, kTrueNorthState } from '../shared/storage/keys';
import { sessionEpoch } from './session-lifecycle';
import { storage } from './storage';

type DailyKit = 'quiet_wins' | 'new_lens';
const pending = new Set<{ kit: DailyKit; date: string; epoch: number }>();
const listeners = new Set<() => void>();
const completionKeys = new Set([
  kNewLensState.name, kQuietWinsState.name, kTameEnemyState.name,
  kTameStatus.name, kTrueNorthState.name,
]);

/** Temporary UI reservation only. Failed submissions never spend a day. */
export function beginKitCompletion(kit: DailyKit, date: string): () => void {
  const entry = { kit, date, epoch: sessionEpoch() };
  pending.add(entry);
  listeners.forEach(listener => listener());
  return () => {
    if (pending.delete(entry)) listeners.forEach(listener => listener());
  };
}

export function isKitCompletionPending(kit: DailyKit, date: string): boolean {
  return [...pending].some(entry => entry.kit === kit && entry.date === date && entry.epoch === sessionEpoch());
}

/** Local writes notify even when the retained Bunny sheet is behind a Kit. */
export function subscribeKitCompletion(listener: () => void): () => void {
  listeners.add(listener);
  const subscription = storage.addOnValueChangedListener(key => {
    if (completionKeys.has(key)) listener();
  });
  return () => {
    listeners.delete(listener);
    subscription.remove();
  };
}
