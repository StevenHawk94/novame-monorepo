import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { fetchMajorUpdateBootstrap, type MajorUpdateBootstrap } from './app-major-update-api';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { clearBurrowSnapshot, persistBurrowSnapshot, readBurrowSnapshot, persistBurrowActionKeys, readBurrowActionKeys } from './burrow-cache';

type State = { data: MajorUpdateBootstrap | null; loading: boolean; busy: boolean; error: string | null; receivedAt: number };
let state: State = { data: null, loading: false, busy: false, error: null, receivedAt: 0 };
const listeners = new Set<() => void>();
const pendingKeys = new Map<string, string>();
const confirmedPhotos = new Map<string, { photo: MajorUpdateBootstrap['roomPhotos'][number]; after: number }>();
const confirmedLoadouts = new Map<string, { rows: MajorUpdateBootstrap['loadouts']; ownerId: string; outfit: boolean; after: number }>();
let musicSelection: { id: string | null; token: number; after: number } | null = null;
let musicToken = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
// Native monotonic time ignores phone clock edits. Server timestamps still
// decide settlement/rewards; this is only a foreground display projection.
export const burrowClock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
export const getBurrowSnapshot = () => state;
/** Apply a confirmed photo receipt before the editor/camera closes. */
export function setBurrowPhotoLocally(photo: MajorUpdateBootstrap['roomPhotos'][number]) {
  if (!state.data) return;
  const data = { ...state.data, roomPhotos: [...state.data.roomPhotos.filter(row => !(row.ownerId === photo.ownerId && row.kind === photo.kind)), photo] };
  if (photo.kind === 'doll') data.dollChangeUsed = true;
  confirmedPhotos.set(`${photo.ownerId}:${photo.kind}`, { photo, after: burrowClock() });
  publish({ data }); persistBurrowSnapshot(data, burrowClock() - state.receivedAt);
}
/** Immediate local playback/selection; the next authoritative snapshot wins. */
export function selectBurrowMusicLocally(trackId: string | null) {
  const token = ++musicToken;
  musicSelection = { id: trackId, token, after: Infinity };
  if (state.data) publish({ data: { ...state.data, musicTrackId: trackId } });
  return token;
}
export function confirmBurrowMusicLocally(token: number, rollback?: string | null) {
  if (musicSelection?.token !== token) return;
  if (rollback !== undefined) {
    musicSelection = null;
    if (state.data) publish({ data: { ...state.data, musicTrackId: rollback } });
  } else musicSelection.after = burrowClock();
}
/** A received gesture disappears from the inbox immediately; sync corrects it if the request fails. */
export function receiveBurrowAffectionLocally(id: string) {
  if (!state.data || !state.data.affectionInbox.some(event => event.id === id)) return;
  publish({ data: { ...state.data,
    affectionInbox: state.data.affectionInbox.filter(event => event.id !== id),
    unread: { ...state.data.unread, affection: Math.max(0, state.data.unread.affection - 1) },
  } });
}
export function setBurrowLoadoutLocally(slots: Record<string,string>, ownerId: string, outfit = false) {
  if (!state.data) return;
  const personal = outfit || !state.data.partner;
  const previous=state.data.loadouts.filter(row=>outfit
    ? !(row.room_type==='home'&&row.owner_id===ownerId&&row.slot==='outfit')
    : !((row.room_type==='our'||(row.room_type==='home'&&row.owner_id===ownerId))&&row.slot!=='outfit'));
  const room_type: 'home'|'our'=personal?'home':'our';
  const owner_id=personal?ownerId:null;
  const rows = Object.entries(slots).map(([slot,item_id])=>({room_type,owner_id,slot,item_id}));
  confirmedLoadouts.set(outfit ? `outfit:${ownerId}` : 'decor', { rows, ownerId, outfit, after: burrowClock() });
  const data = {...state.data,loadouts:[...previous,...rows]};
  publish({data}); persistBurrowSnapshot(data, burrowClock() - state.receivedAt);
}
/** Show the digging state as soon as the user starts today's journey. */
export function startBurrowAdventureLocally(recordId: string) {
  if (!state.data || state.data.activeAdventure || state.data.readyRecordId !== recordId) return;
  const startedAt=new Date();
  const endsAt=new Date(startedAt.getTime()+60_000); // temporary Adventure test duration
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
    care_cooldown: 'Your bunny or flower is happy now. Come back in 12 hours.',
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
let requestStartedAt = 0;
let followup: Promise<void> | null = null;
let latestRefreshAfter = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const operations = new Map<string, Promise<boolean>>();
const FOCUS_REFRESH_MIN_MS = 30_000;
function restore() {
  const owner = sessionUserId();
  if (!owner) return;
  for (const [name, key] of readBurrowActionKeys(owner)) pendingKeys.set(name, key);
  const cached = readBurrowSnapshot(owner);
  if (cached) publish({ data: cached.data, receivedAt: burrowClock() - Math.max(0, Date.now() - cached.savedAt) });
}
const persistKeys = () => { const owner = sessionUserId(); if (owner) persistBurrowActionKeys(owner, pendingKeys); };
/** Drop private pair data immediately; late snapshots cannot restore it. */
export function invalidateBurrowPair() {
  clearBurrowSnapshot();
  revision++; flight = null; pendingKeys.clear(); confirmedPhotos.clear(); confirmedLoadouts.clear(); musicSelection = null; operations.clear(); followup = null; latestRefreshAfter = 0;
  if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null;
  publish({ data: null, loading: false, busy: false, error: null, receivedAt: 0 });
}
subscribeSessionIdentity(() => {
  revision++;
  flight = null; pendingKeys.clear(); confirmedPhotos.clear(); confirmedLoadouts.clear(); musicSelection = null;
  publish({ data: null, loading: false, busy: false, error: null, receivedAt: 0 });
  operations.clear(); followup = null; latestRefreshAfter = 0;
  if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null;
  restore();
});
restore();

export function refreshBurrow({ silent = false }: { silent?: boolean } = {}) {
  if (flight) return flight;
  const epoch = sessionEpoch();
  const requestRevision = revision;
  requestStartedAt = burrowClock();
  if (!silent || !state.data) publish({ loading: true, error: null });
  const task = fetchMajorUpdateBootstrap({ force: true }).then(data => {
    if (epoch === sessionEpoch() && requestRevision === revision) {
      if (state.data && (state.data.partner?.id !== data.partner?.id || state.data.pairVersion !== data.pairVersion)) {
        confirmedPhotos.clear(); confirmedLoadouts.clear(); musicSelection = null;
      }
      if (musicSelection) {
        if (requestStartedAt <= musicSelection.after) data = { ...data, musicTrackId: musicSelection.id };
        else musicSelection = null;
      }
      for (const [key, { photo: receipt, after }] of confirmedPhotos) {
        const remote = data.roomPhotos.find(row => row.ownerId === receipt.ownerId && row.kind === receipt.kind);
        if (requestStartedAt >= after || (remote && Date.parse(remote.updatedAt) >= Date.parse(receipt.updatedAt))) confirmedPhotos.delete(key);
        else data = { ...data, roomPhotos: [...data.roomPhotos.filter(row => !(row.ownerId === receipt.ownerId && row.kind === receipt.kind)), receipt] };
      }
      for (const [key, receipt] of confirmedLoadouts) {
        if (requestStartedAt >= receipt.after) { confirmedLoadouts.delete(key); continue; }
        const previous = data.loadouts.filter(row => receipt.outfit
          ? !(row.room_type === 'home' && row.owner_id === receipt.ownerId && row.slot === 'outfit')
          : !((row.room_type === 'our' || (row.room_type === 'home' && row.owner_id === receipt.ownerId)) && row.slot !== 'outfit'));
        data = { ...data, loadouts: [...previous, ...receipt.rows] };
      }
      publish({ data, receivedAt: burrowClock(), error: null }); persistBurrowSnapshot(data);
    }
  }).catch(error => {
    if (epoch === sessionEpoch() && requestRevision === revision) {
      const code = errorCode(error);
      if (['not_paired','feature_disabled'].includes(code)) clearBurrowSnapshot();
      publish({ error: code, ...(['not_paired','feature_disabled'].includes(code) ? { data: null } : {}) });
    }
  }).finally(() => {
    if (flight === task) { flight = null; if (state.loading) publish({ loading: false }); }
  });
  flight = task;
  return task;
}

/** Reopening a recently viewed page uses the shared snapshot without a request. */
export function refreshBurrowIfStale() {
  if (state.data && burrowClock() - state.receivedAt < FOCUS_REFRESH_MIN_MS) return Promise.resolve();
  return refreshBurrow({ silent: !!state.data });
}

/** A request begun before backgrounding cannot satisfy a resume check. */
export function refreshBurrowAfterCurrent({ silent = true, after }: { silent?: boolean; after?: number } = {}) {
  // Entry/resume checks share the current read. Only a mutation that completed
  // AFTER that read started needs one coalesced follow-up.
  if (after === undefined || !flight || requestStartedAt >= after) return refreshBurrow({ silent });
  latestRefreshAfter = Math.max(latestRefreshAfter, after);
  if (followup) return followup;
  const epoch = sessionEpoch(), requestRevision = revision;
  const task = flight.then(async () => {
    while (epoch === sessionEpoch() && requestRevision === revision && requestStartedAt < latestRefreshAfter)
      await refreshBurrow({ silent });
  })
    .finally(() => { if (followup === task) followup = null; });
  followup = task; return task;
}
/** Burst interactions cause a single background snapshot, not one per tap. */
export function scheduleBurrowRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const after = burrowClock(), epoch = sessionEpoch();
  refreshTimer = setTimeout(() => { refreshTimer = null; if (epoch === sessionEpoch()) void refreshBurrowAfterCurrent({ after }); }, 400);
}

/** Keep a command key on uncertain failures so the Retry button cannot double debit. */
export function runBurrowAction(operation: string, action: (key: string) => Promise<unknown>, { silent = false }: { silent?: boolean } = {}): Promise<boolean> {
  const existing = operations.get(operation); if (existing) return existing;
  if (!silent && state.busy) return Promise.resolve(false);
  const task = execute().finally(() => { if (operations.get(operation) === task) operations.delete(operation); });
  operations.set(operation, task); return task;
  async function execute() {
  const epoch = sessionEpoch();
  const actionRevision = revision;
  const key = pendingKeys.get(operation) ?? randomUUID();
  pendingKeys.set(operation, key);
  persistKeys();
  if (!silent) publish({ busy: true, error: null });
  try {
    await action(key);
    if (epoch !== sessionEpoch() || actionRevision !== revision) return false;
    pendingKeys.delete(operation);
    persistKeys(); scheduleBurrowRefresh();
    return epoch === sessionEpoch() && actionRevision === revision;
  } catch (error) {
    if (epoch === sessionEpoch() && actionRevision === revision) publish({ error: errorCode(error) });
    return false;
  } finally {
    if (!silent && epoch === sessionEpoch() && actionRevision === revision) publish({ busy: false });
  }
  }
}

export function useBurrowSnapshot() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function useBurrow() {
  const snapshot = useBurrowSnapshot();
  useFocusEffect(useCallback(() => {
    void refreshBurrowIfStale();
    const sub = AppState.addEventListener('change', value => { if (value === 'active') void refreshBurrowIfStale(); });
    return () => sub.remove();
  }, []));
  return snapshot;
}
