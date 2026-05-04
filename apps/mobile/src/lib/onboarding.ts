import { storage } from './storage';
import { apiClient } from './api';

/**
 * Onboarding state management for the new NovaMe mobile app.
 *
 * MMKV-backed state covering all 11 onboarding screens. Mirrors the
 * old Capacitor localStorage layout (D34 decision: same key
 * "novame_onboarding_state") but as a single JSON blob instead of
 * separate keys, since MMKV reads JSON-encoded blobs efficiently
 * and we want atomic state updates.
 *
 * Persistence design (Q-3.5-B = sa/s7 also persisted):
 *   - aspireWords, sa, s7, charName persisted on every change
 *   - done flag flipped only at step 11 finish
 *
 * Sync to Supabase happens AFTER sign-in (B40 deferred to 3.5).
 *   - Onboarding data is collected pre-auth (user is anonymous)
 *   - After sign-in (Email / Apple / Google), onAuthStateChange
 *     listener in app/_layout.tsx checks if pending onboarding
 *     data exists and calls syncOnboardingDataToServer with the
 *     fresh user.id
 *   - Sync clears mmkv onboarding data on success so it doesn't
 *     re-sync on every subsequent app launch
 */

const STORAGE_KEY = 'novame_onboarding_state';

// ---- types ----

export type OnboardingS4 = 'A' | 'B' | 'C';
export type OnboardingS7 = 'A' | 'B' | 'C' | 'D';

/**
 * Full onboarding state. All fields default to empty / null on first launch.
 *
 * Fields:
 *   done           — true once user finishes step 11 (used by app/index.tsx
 *                    to skip onboarding flow on subsequent launches)
 *   aspireWords    — 4-6 selected from ASPIRE_WORDS list (step 2)
 *   sa             — answer to "How far away does that version feel?" (step 4)
 *   s7             — answer to "Why did you open NovaMe?" (step 7)
 *   charName       — companion name, 1-12 chars (step 10)
 *   pendingSync    — true if sign-in needs to trigger syncOnboardingDataToServer.
 *                    Set to true at step 11 finish; cleared after successful sync.
 */
export type OnboardingState = {
  done: boolean;
  aspireWords: string[];
  sa: OnboardingS4 | null;
  s7: OnboardingS7 | null;
  charName: string;
  pendingSync: boolean;
};

const DEFAULT_STATE: OnboardingState = {
  done: false,
  aspireWords: [],
  sa: null,
  s7: null,
  charName: '',
  pendingSync: false,
};

// ---- mmkv read / write ----

/**
 * Reads the current onboarding state from MMKV. Returns DEFAULT_STATE
 * if no state has been saved yet (first launch) or if the saved
 * value is corrupt JSON.
 */
export function getOnboardingState(): OnboardingState {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/**
 * Updates only the provided fields, leaving the rest untouched.
 * Used by every onboarding screen as the user fills in answers.
 */
export function patchOnboardingState(patch: Partial<OnboardingState>): void {
  const current = getOnboardingState();
  const next: OnboardingState = { ...current, ...patch };
  storage.set(STORAGE_KEY, JSON.stringify(next));
}

/**
 * Convenience: returns true if the user has completed all 11 screens.
 *
 * Used by app/index.tsx redirect logic (B34 trigger) to decide
 * whether to send the user to (onboarding) or to the auth / main
 * tabs flow.
 */
export function isOnboardingDone(): boolean {
  return getOnboardingState().done;
}

/**
 * Marks onboarding complete and flags sync as pending.
 *
 * Called from step 11 "Start My Journey" button. After this:
 *   - app/index.tsx will no longer redirect to (onboarding)
 *   - The next sign-in event will trigger server-side sync
 */
export function markOnboardingComplete(): void {
  patchOnboardingState({ done: true, pendingSync: true });
}

/**
 * Clears all onboarding state.
 *
 * Called after successful syncOnboardingDataToServer (server has
 * the data, mmkv copy no longer needed) and is also useful for
 * forced reset during development. Does NOT clear other MMKV keys.
 */
export function clearOnboardingState(): void {
  storage.remove(STORAGE_KEY);
}

// ---- server sync ----

/**
 * Syncs collected onboarding data to Supabase via the apps/api routes.
 *
 * Should be called AFTER sign-in completes (onAuthStateChange SIGNED_IN
 * listener). Idempotent: if the server already shows
 * has_completed_onboarding === true, the local data is just discarded
 * (a returning user re-installing the app should keep their server data).
 *
 * Two API calls in parallel:
 *   1. POST /api/character-state action: 'init_character' with the
 *      companion name (writes to character_data table)
 *   2. POST /api/user-sync with aspireWords / aspireScores / wisdomPortrait
 *      (writes to profiles table)
 *
 * NOTE: Old Capacitor mobile passed `characterName` to /api/user-sync
 * as well, but the user-sync route does not consume that field. The
 * companion name lives only in character_data table via /api/character-state.
 *
 * On success, clears the mmkv onboarding state so this never runs twice
 * for the same user.
 *
 * On error: keeps mmkv state intact and re-throws. The caller (auth
 * listener) decides whether to surface the error or silently retry on
 * next launch.
 */
export async function syncOnboardingDataToServer(userId: string): Promise<void> {
  if (!userId) {
    throw new Error('syncOnboardingDataToServer called without userId');
  }

  const state = getOnboardingState();

  // 1. Check if server already has onboarding data (returning user).
  type UserSyncCheck = {
    success?: boolean;
    data?: { hasCompletedOnboarding?: boolean };
  };
  const check = await apiClient.get<UserSyncCheck>(`/api/user-sync?userId=${userId}`);
  if (check?.success && check.data?.hasCompletedOnboarding === true) {
    // Server already has it. Discard local copy.
    clearOnboardingState();
    return;
  }

  // 2. Build payloads.
  const charName = state.charName.trim() || 'Nova';
  const aspireWords = state.aspireWords;
  const aspireScores: Record<string, number> = {};
  aspireWords.forEach((w) => {
    aspireScores[w] = 70;
  });
  const wisdomPortrait =
    aspireWords.length > 0
      ? `A seeker of ${aspireWords.slice(0, 3).join(', ')} — just getting started.`
      : 'A wisdom seeker beginning their journey.';

  // 3. Parallel POSTs.
  await Promise.all([
    apiClient.post('/api/character-state', {
      userId,
      action: 'init_character',
      characterId: 'char-1',
      characterName: charName,
    }),
    apiClient.post('/api/user-sync', {
      userId,
      hasCompletedOnboarding: true,
      selectedCharacter: 'char-1',
      drainWords: [],
      aspireWords,
      aspireScores,
      betterSelfScore: 70,
      wisdomPortrait,
    }),
  ]);

  // 4. Success: clear local state (server is the source of truth now).
  clearOnboardingState();
}

/**
 * Convenience for the auth listener: checks the pendingSync flag and
 * calls sync if needed. Catches errors silently (logs only) so that
 * a failed sync does not block the navigation to (main)/(tabs).
 *
 * Called from app/_layout.tsx onAuthStateChange SIGNED_IN handler.
 */
export async function syncOnboardingIfPending(userId: string): Promise<void> {
  const state = getOnboardingState();
  if (!state.pendingSync) return;
  try {
    await syncOnboardingDataToServer(userId);
  } catch (e) {
    // Sync failure is not fatal — keep mmkv state, retry on next launch.
    // eslint-disable-next-line no-console
    console.warn('[onboarding] sync failed, will retry on next launch:', e);
  }
}
