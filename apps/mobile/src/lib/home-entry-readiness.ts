/**
 * One in-memory hand-off, armed only by finishing onboarding. This is not an
 * asset/data cache and never changes a TTL, session, or returning-user launch.
 * Readiness comes from the actual mounted Home, not a throw-away prefetch view.
 */
export const HOME_ENTRY_ASSETS = [
  'scene', 'companion', 'menu', 'outfits', 'scenes',
  'tab:index', 'tab:bags', 'tab:quests', 'tab:friends', 'tab:status',
  'home-layout', 'tabs-layout',
] as const;
export type HomeEntryAsset = typeof HOME_ENTRY_ASSETS[number];
type FollowUp = 'notification-settings' | null;
type EntryState = {
  pending: boolean;
  attempt: number;
  ready: readonly HomeEntryAsset[];
  failed: boolean;
  after: FollowUp;
};
let state: EntryState = { pending: false, attempt: 0, ready: [], failed: false, after: null };
const listeners = new Set<() => void>();

export const getHomeEntryState = (): EntryState => state;
export function subscribeHomeEntry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: EntryState): void {
  state = next;
  listeners.forEach((listener) => listener());
}
export function beginHomeEntry(): void {
  if (state.pending) return;
  publish({ pending: true, attempt: state.attempt + 1, ready: [], failed: false, after: null });
}
export function deferHomeEntryNotification(): void {
  if (state.pending) publish({ ...state, after: 'notification-settings' });
}
export function homeEntryIsReady(): boolean {
  return state.pending && HOME_ENTRY_ASSETS.every((asset) => state.ready.includes(asset));
}
export function markHomeEntryAsset(asset: HomeEntryAsset, attempt: number): void {
  if (!state.pending || attempt !== state.attempt || state.ready.includes(asset)) return;
  publish({ ...state, ready: [...state.ready, asset] });
}
export function failHomeEntry(attempt: number): void {
  if (!state.pending || attempt !== state.attempt || homeEntryIsReady() || state.failed) return;
  publish({ ...state, failed: true });
}
export function retryHomeEntry(): void {
  if (!state.pending) return;
  publish({ ...state, attempt: state.attempt + 1, ready: [], failed: false });
}
export function finishHomeEntry(attempt: number): FollowUp {
  if (attempt !== state.attempt || !homeEntryIsReady()) return null;
  const after = state.after;
  // Keep the attempt/key unchanged: never recreate the ready native views.
  publish({ ...state, pending: false, after: null });
  return after;
}
