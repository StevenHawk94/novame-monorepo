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
/** Immediate local playback/selection; the next authoritative snapshot wins. */
export function selectBurrowMusicLocally(trackId: string | null) {
  if (state.data) publish({ data: { ...state.data, musicTrackId: trackId } });
}
export function setBurrowLoadoutLocally(slots: Record<string,string>, ownerId: string, outfit = false) {
  if (!state.data) return;
  const previous=state.data.loadouts.filter(row=>outfit
    ? !(row.room_type==='home'&&row.owner_id===ownerId&&row.slot==='outfit')
    : !(row.room_type==='our'&&row.slot!=='outfit'));
  const room_type: 'home'|'our'=outfit?'home':'our';
  const owner_id=outfit?ownerId:null;
  publish({data:{...state.data,loadouts:[...previous,...Object.entries(slots).map(([slot,item_id])=>({room_type,owner_id,slot,item_id}))]}});
}
/** Show the digging state as soon as the user starts today's journey. */
export function startBurrowAdventureLocally(recordId: string) {
  if (!state.data || state.data.activeAdventure || state.data.readyRecordId !== recordId) return;
  const startedAt=new Date();
  const endsAt=new Date(startedAt.getTime()+(state.data.hasPlus?2:8)*60*60*1000);
  publish({data:{...state.data,activeAdventure:{id:`pending:${recordId}`,status:'in_progress',started_at:startedAt.toISOString(),ends_at:endsAt.toISOString()},dailyAdventureUsed:true,readyRecordId:null}});
}
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

export function refreshBurrow({ silent = false }: { silent?: boolean } = {}) {
  if (flight) return flight;
  const epoch = sessionEpoch();
  const requestRevision = revision;
  if (!silent || !state.data) publish({ loading: true, error: null });
  const task = fetchMajorUpdateBootstrap({ force: true }).then(data => {
    if (epoch === sessionEpoch() && requestRevision === revision) publish({ data, receivedAt: burrowClock(), error: null });
  }).catch(error => {
    if (epoch === sessionEpoch() && requestRevision === revision) {
      const code = errorCode(error);
      publish({ error: code, ...(['not_paired','feature_disabled'].includes(code) ? { data: null } : {}) });
    }
  }).finally(() => {
    if (flight === task) { flight = null; if (state.loading) publish({ loading: false }); }
  });
  flight = task;
  return task;
}

/** A request begun before backgrounding cannot satisfy a resume check. */
export async function refreshBurrowAfterCurrent({ silent = false }: { silent?: boolean } = {}) {
  const epoch = sessionEpoch();
  if (flight) await flight;
  if (epoch === sessionEpoch()) await refreshBurrow({ silent });
}

/** Keep a command key on uncertain failures so the Retry button cannot double debit. */
export async function runBurrowAction(operation: string, action: (key: string) => Promise<unknown>, { silent = false }: { silent?: boolean } = {}) {
  if (!silent && state.busy) return false;
  const epoch = sessionEpoch();
  const actionRevision = revision;
  const key = pendingKeys.get(operation) ?? randomUUID();
  pendingKeys.set(operation, key);
  if (!silent) publish({ busy: true, error: null });
  try {
    await action(key);
    if (epoch !== sessionEpoch() || actionRevision !== revision) return false;
    pendingKeys.delete(operation);
    if (silent) void refreshBurrowAfterCurrent({ silent: true });
    else await refreshBurrowAfterCurrent({ silent: true });
    return epoch === sessionEpoch() && actionRevision === revision;
  } catch (error) {
    if (epoch === sessionEpoch() && actionRevision === revision) publish({ error: errorCode(error) });
    return false;
  } finally {
    if (!silent && epoch === sessionEpoch() && actionRevision === revision) publish({ busy: false });
  }
}

export function useBurrowSnapshot() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function useBurrow() {
  const snapshot = useBurrowSnapshot();
  useFocusEffect(useCallback(() => {
    void refreshBurrow({ silent: !!state.data });
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void refreshBurrow({ silent: !!state.data }); });
    return () => sub.remove();
  }, []));
  return snapshot;
}
