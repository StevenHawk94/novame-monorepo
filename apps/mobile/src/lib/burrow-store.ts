import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { fetchMajorUpdateBootstrap, type MajorUpdateBootstrap } from './app-major-update-api';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';

type State = { data: MajorUpdateBootstrap | null; loading: boolean; busy: boolean; error: string | null; receivedAt: number };
let state: State = { data: null, loading: false, busy: false, error: null, receivedAt: 0 };
const listeners = new Set<() => void>();
const pendingKeys = new Map<string, string>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
// Native monotonic time ignores phone clock edits. Server timestamps still
// decide settlement/rewards; this is only a foreground display projection.
export const burrowClock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
export const getBurrowSnapshot = () => state;
function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'body' in error) {
    const body = error.body;
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  }
  return error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'network_error';
}
export function burrowErrorMessage(code: string): string {
  const messages: Record<string,string> = {
    not_paired: 'Connect with your person to use this shared feature.',
    feature_disabled: 'This update is not available yet. Please refresh or return to Home.',
    insufficient_balance: 'You don’t have enough carrots for this item yet.',
    cooldown_active: 'Your next free gesture isn’t ready yet. Refresh to see the time.',
    already_full: 'Your bunny has everything it needs for now.',
    already_owned: 'That item is already owned, or waiting to be opened.',
    plus_required: 'This little extra needs Burrow Plus.',
    daily_adventure_used: 'Your bunny has already started today’s adventure.',
    adventure_pending: 'Finish your current adventure before starting another.',
    record_required: 'Save today’s story before starting the adventure.',
    not_completed: 'There’s a little more to do before collecting this reward.',
    idempotency_conflict: 'This request has changed. Refresh before trying again.',
    battle_required: 'Your friend is still waiting. Finish the matching Rage Room battle, then come back to collect.',
    content_unavailable: 'This saved story is unavailable. Your discovery is safe; please try refreshing.',
    already_done: 'You’ve faced this feeling today. You can help your friend tomorrow, or your partner can help.',
    daily_limit_reached: 'Both battles are complete for today. Come back after your local midnight.',
    photo_unavailable: 'The photo could not be saved or loaded. Please try again.',
    sharing_conflict: 'This diary’s privacy changed on another device. Refresh before choosing again.',
    pair_changed: 'Your connection changed. Refresh and review your person before trying again.',
    client_upgrade_required: 'Please update the app before changing this setting.',
    upload_limit: 'Too many photo attempts. Please try again in an hour.',
  };
  return messages[code] ?? 'That didn’t finish. Check your connection and try again.';
}
let flight: Promise<void> | null = null;
let revision = 0;
/** Drop private pair data immediately; late snapshots cannot restore it. */
export function invalidateBurrowPair() {
  revision++; flight = null; pendingKeys.clear();
  publish({ data: null, loading: false, busy: false, error: null, receivedAt: 0 });
}
subscribeSessionIdentity(() => {
  revision++;
  flight = null; pendingKeys.clear();
  publish({ data: null, loading: false, busy: false, error: null, receivedAt: 0 });
});

export function refreshBurrow() {
  if (flight) return flight;
  const epoch = sessionEpoch();
  const requestRevision = revision;
  publish({ loading: true, error: null });
  const task = fetchMajorUpdateBootstrap({ force: true }).then(data => {
    if (epoch === sessionEpoch() && requestRevision === revision) publish({ data, receivedAt: burrowClock() });
  }).catch(error => {
    if (epoch === sessionEpoch() && requestRevision === revision) {
      const code = errorCode(error);
      publish({ error: code, ...(['not_paired','feature_disabled'].includes(code) ? { data: null } : {}) });
    }
  }).finally(() => {
    if (flight === task) { flight = null; publish({ loading: false }); }
  });
  flight = task;
  return task;
}

/** A request begun before backgrounding cannot satisfy a resume check. */
export async function refreshBurrowAfterCurrent() {
  const epoch = sessionEpoch();
  if (flight) await flight;
  if (epoch === sessionEpoch()) await refreshBurrow();
}

/** Keep a command key on uncertain failures so the Retry button cannot double debit. */
export async function runBurrowAction(operation: string, action: (key: string) => Promise<unknown>) {
  if (state.busy) return false;
  const epoch = sessionEpoch();
  const actionRevision = revision;
  const key = pendingKeys.get(operation) ?? randomUUID();
  pendingKeys.set(operation, key);
  publish({ busy: true, error: null });
  try {
    await action(key);
    if (epoch !== sessionEpoch() || actionRevision !== revision) return false;
    pendingKeys.delete(operation);
    await refreshBurrow();
    return epoch === sessionEpoch() && actionRevision === revision;
  } catch (error) {
    if (epoch === sessionEpoch() && actionRevision === revision) publish({ error: errorCode(error) });
    return false;
  } finally {
    if (epoch === sessionEpoch() && actionRevision === revision) publish({ busy: false });
  }
}

export function useBurrowSnapshot() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function useBurrow() {
  const snapshot = useBurrowSnapshot();
  useFocusEffect(useCallback(() => {
    void refreshBurrow();
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void refreshBurrow(); });
    return () => sub.remove();
  }, []));
  return snapshot;
}
