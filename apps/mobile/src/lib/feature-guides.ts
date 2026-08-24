import { storage } from './storage';
import { kFeatureGuidesPending, kFeatureGuideState } from '../shared/storage/keys';

export type FeatureGuideId =
  | 'reflect'
  | 'focus'
  | 'paired'
  | 'connection'
  | 'memories'
  | 'bunny'
  | 'quests';

interface FeatureGuideState {
  version: 1;
  completed: FeatureGuideId[];
}

function readState(): FeatureGuideState | null {
  const raw = storage.getString(kFeatureGuideState.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FeatureGuideState>;
    return {
      version: 1,
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter((id): id is FeatureGuideId => typeof id === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

function writeState(state: FeatureGuideState): void {
  storage.set(kFeatureGuideState.name, JSON.stringify(state));
}

/** Called only when the current user finishes the fresh pre-auth onboarding. */
export function enableFeatureGuidesForNewUser(): void {
  storage.set(kFeatureGuidesPending.name, 'true');
}

/**
 * Lazily promotes the pre-auth marker after auth has settled and the user
 * actually focuses a feature. Keeping this out of startup avoids adding work
 * to Home and prevents any existing page cache from being touched.
 */
export function shouldShowFeatureGuide(id: FeatureGuideId): boolean {
  let state = readState();
  if (!state) {
    if (storage.getString(kFeatureGuidesPending.name) !== 'true') return false;
    state = { version: 1, completed: [] };
    writeState(state);
    storage.remove(kFeatureGuidesPending.name);
  }
  return !state.completed.includes(id);
}

/** Mark completion only when the walkthrough is dismissed, not merely queued. */
export function completeFeatureGuide(id: FeatureGuideId): void {
  const state = readState();
  if (!state || state.completed.includes(id)) return;
  writeState({ ...state, completed: [...state.completed, id] });
}
