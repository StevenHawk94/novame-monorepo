/**
 * In-memory visual hand-off for onboarding, cold launch and long resume.
 * This is not an asset/data cache and never changes a TTL or session.
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
  resumeRequired: boolean;
  attempt: number;
  ready: readonly HomeEntryAsset[];
  failed: boolean;
  after: FollowUp;
};
let state: EntryState = { pending: false, resumeRequired: false, attempt: 0, ready: [], failed: false, after: null };
const listeners = new Set<() => void>();
// Keep the established long-background threshold; do not refresh data caches.
export const HOME_RESUME_AFTER_MS = 30 * 60_000;
let backgroundAt: number | null = null;

export function isHomeEntryRoute(segments: readonly string[]): boolean {
  return segments[0] === '(main)' && segments[1] === '(tabs)'
    && (segments.length === 2 || (segments.length === 3 && segments[2] === 'index'));
}

/** Inactive (StoreKit, Face ID, notification shade) is not a long background. */
export function observeHomeEntryAppState(value: string, now = Date.now()): void {
  if (value === 'background' && backgroundAt === null) backgroundAt = now;
  if (value !== 'active') return;
  const elapsed = backgroundAt === null ? 0 : now - backgroundAt;
  backgroundAt = null;
  if (elapsed < HOME_RESUME_AFTER_MS) return;
  // Queue while another screen is open; never dismiss an unfinished activity.
  // Invalidate old native callbacks if backgrounding interrupted the gate.
  publish({ ...state, pending: false, resumeRequired: true,
    ready: [], failed: false });
}

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
  publish({ ...state, pending: true, resumeRequired: false, attempt: state.attempt + 1, ready: [], failed: false });
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
