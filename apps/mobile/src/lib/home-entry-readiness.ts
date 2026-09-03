/**
 * In-memory visual hand-off for cold launch, long resume and external entry.
 * Cached native/local visuals paint underneath the cover immediately; only
 * data that can have changed while the app was away is revalidated.
 */
export const HOME_ENTRY_ASSETS = [
  'scene', 'companion', 'menu', 'outfits', 'scenes',
  'tab:index', 'tab:bags', 'tab:quests', 'tab:friends', 'tab:status',
  'home-layout', 'home-data', 'tabs-layout',
  'friends-background', 'friends-data', 'entry-copy',
] as const;

export type HomeEntryAsset = typeof HOME_ENTRY_ASSETS[number];
export type HomeEntryTarget = 'home' | 'friends' | 'current';
type FollowUp = 'notification-settings' | null;
type EntryState = {
  pending: boolean;
  resumeRequired: boolean;
  forceData: boolean;
  target: HomeEntryTarget;
  attempt: number;
  ready: readonly HomeEntryAsset[];
  failed: boolean;
  after: FollowUp;
};

const SHARED_ASSETS: readonly HomeEntryAsset[] = [
  'tab:index', 'tab:bags', 'tab:quests', 'tab:friends', 'tab:status',
  'tabs-layout', 'entry-copy',
];
const HOME_ASSETS: readonly HomeEntryAsset[] = [
  ...SHARED_ASSETS,
  'scene', 'companion', 'menu', 'outfits', 'scenes', 'home-layout', 'home-data',
];
const FRIENDS_ASSETS: readonly HomeEntryAsset[] = [
  ...SHARED_ASSETS, 'friends-background', 'friends-data',
];

let state: EntryState = {
  pending: false,
  resumeRequired: false,
  forceData: false,
  target: 'home',
  attempt: 0,
  ready: [],
  failed: false,
  after: null,
};
const listeners = new Set<() => void>();
export const HOME_RESUME_AFTER_MS = 30 * 60_000;
export const HOME_ENTRY_TIMEOUT_MS = 5_000;
let backgroundAt: number | null = null;

export function isHomeEntryRoute(segments: readonly string[]): boolean {
  return segments[0] === '(main)' && segments[1] === '(tabs)'
    && (segments.length === 2 || (segments.length === 3 && segments[2] === 'index'));
}

export function isFriendsEntryRoute(segments: readonly string[]): boolean {
  return segments[0] === '(main)' && segments[1] === '(tabs)' && segments[2] === 'friends';
}

/** Inactive (StoreKit, Face ID, notification shade) is not a long background. */
export function observeHomeEntryAppState(value: string, now = Date.now()): void {
  if (value === 'background' && backgroundAt === null) backgroundAt = now;
  if (value !== 'active') return;
  const elapsed = backgroundAt === null ? 0 : now - backgroundAt;
  backgroundAt = null;
  if (elapsed < HOME_RESUME_AFTER_MS) return;
  // Queue while another screen is open; the mounted main route chooses the
  // correct target and never dismisses an unfinished activity.
  publish({
    ...state,
    pending: false,
    resumeRequired: true,
    forceData: false,
    ready: [],
    failed: false,
  });
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

export function beginHomeEntry(options?: {
  forceHomeData?: boolean;
  target?: HomeEntryTarget;
}): void {
  const forceData = options?.forceHomeData === true;
  const target = options?.target ?? (state.pending ? state.target : 'home');
  if (state.pending) {
    // A cold launch may already own the cover when an external event arrives.
    // A different explicit target starts a clean attempt; the same target is
    // simply upgraded to a forced server revalidation.
    if (options?.target && target !== state.target) {
      publish({
        ...state,
        target,
        forceData,
        attempt: state.attempt + 1,
        ready: [],
        failed: false,
      });
    } else if (forceData && !state.forceData) {
      publish({ ...state, forceData: true });
    }
    return;
  }
  publish({
    ...state,
    pending: true,
    resumeRequired: false,
    forceData,
    target,
    attempt: state.attempt + 1,
    ready: [],
    failed: false,
  });
}

export function deferHomeEntryNotification(): void {
  if (state.pending) publish({ ...state, after: 'notification-settings' });
}

function requiredAssets(target: HomeEntryTarget): readonly HomeEntryAsset[] {
  if (target === 'home') return HOME_ASSETS;
  if (target === 'friends') return FRIENDS_ASSETS;
  return ['entry-copy'];
}

export function homeEntryIsReady(): boolean {
  return state.pending && requiredAssets(state.target).every((asset) => state.ready.includes(asset));
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
  publish({ ...state, pending: false, after: null });
  return after;
}

/** Five-second fail-open. Late callbacks are ignored by pending/attempt checks. */
export function timeoutHomeEntry(attempt: number): FollowUp {
  if (!state.pending || attempt !== state.attempt) return null;
  const after = state.after;
  publish({ ...state, pending: false, failed: true, after: null });
  return after;
}
