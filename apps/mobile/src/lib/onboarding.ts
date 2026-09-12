/**
 * Durable onboarding completion + companion initialization (C4).
 *
 * Current onboarding always uses pet1. Before an account exists, that pending
 * completion is stashed under the preauth-scoped kOnboardingState. Once a
 * user_id exists, the task is bound to that exact identity and retried until
 * the idempotent server completion succeeds.
 *
 * The API is idempotent, so syncing twice is harmless: the first call creates
 * the companion, later calls no-op. We clear the local choice after a
 * successful sync so a returning user doesn't re-send it.
 */
import { apiClient } from './api';
import { kOnboardingIntroSeen, kOnboardingState } from '../shared/storage/keys';
import { storage } from './storage';

const companionSyncs = new Map<string, Promise<boolean>>();
let anonymousAuthHandoffUntil = 0;
const COMPANION_SYNC_REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000] as const;

export type CompanionId = 'pet1' | 'pet2' | 'pet3';

interface OnboardingState {
  companionId?: CompanionId;
  /** Identity owning the durable onboarding-completion task. */
  companionSyncUserId?: string;
  companionSyncAttempts?: number;
  companionSyncNextRetryAtMs?: number;
  /** 2026-07-26 onboarding: the bunny's name from "Name Your Bunny". */
  bunnyName?: string;
  /** ob3 choices, kept for the ob4 feedback line + future personalization. */
  whoChoice?: string;
  blockerChoice?: string;
}

function readState(): OnboardingState {
  const raw = storage.getString(kOnboardingState.name);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as OnboardingState;
  } catch {
    return {};
  }
}

/** Mark the intro as seen on this device (survives sign-out). */
export function markIntroSeen(): void {
  storage.set(kOnboardingIntroSeen.name, 'true');
}

/** Whether this phone has seen the onboarding intro. */
export function hasSeenIntro(): boolean {
  return storage.getString(kOnboardingIntroSeen.name) === 'true';
}

/** Persist the current onboarding's default pet before we have a user_id. */
export function setChosenCompanion(companionId: CompanionId): void {
  const state = readState();
  state.companionId = companionId;
  // A newly completed onboarding owns a fresh task. Bind it only after auth
  // has produced the stable user id.
  delete state.companionSyncUserId;
  delete state.companionSyncAttempts;
  delete state.companionSyncNextRetryAtMs;
  storage.set(kOnboardingState.name, JSON.stringify(state));
}

/** The pet chosen during onboarding, if any. */
export function getChosenCompanion(): CompanionId | null {
  return readState().companionId ?? null;
}

/** Let the explicit onboarding flow own its anonymous auth navigation. */
export function beginAnonymousOnboardingAuthHandoff(): void {
  // The global SIGNED_IN listener and the onboarding screen otherwise both
  // navigate to signing-in when ensureSession creates the first guest UUID.
  // A short TTL fails safe if onboarding is interrupted before releasing it.
  anonymousAuthHandoffUntil = Date.now() + 10_000;
}

export function endAnonymousOnboardingAuthHandoff(): void {
  anonymousAuthHandoffUntil = 0;
}

export function isAnonymousOnboardingAuthHandoffActive(): boolean {
  return Date.now() < anonymousAuthHandoffUntil;
}

/**
 * Resume the durable onboarding-completion task. The first call binds a fresh
 * pre-auth task to this user id. Later calls refuse to send it as another user,
 * which prevents an account switch from completing the wrong profile.
 *
 * The request owns a real 30-second timeout. A caller may stop waiting sooner
 * (the signing-in screen releases Home after five seconds), but that does not
 * abort this work. Success clears the task; failure persists retry metadata for
 * the next Home mount or foreground entry. One request per user may be in
 * flight so all lifecycle triggers share the same network operation.
 */
export function syncOnboardingCompanion(
  userId: string,
  options?: { force?: boolean },
): Promise<boolean> {
  let state = readState();
  const companionId = state.companionId;
  if (!companionId) return Promise.resolve(true);

  if (state.companionSyncUserId && state.companionSyncUserId !== userId) {
    return Promise.resolve(true);
  }
  if (!state.companionSyncUserId) {
    state = { ...state, companionSyncUserId: userId };
    writeState(state);
  }

  if (
    !options?.force
    && (state.companionSyncNextRetryAtMs ?? 0) > Date.now()
  ) {
    return Promise.resolve(false);
  }

  const current = companionSyncs.get(userId);
  if (current) return current;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COMPANION_SYNC_REQUEST_TIMEOUT_MS);
    try {
      await apiClient.post(
        '/api/onboarding-complete',
        { userId, companionId },
        { signal: controller.signal },
      );
      // Clear only this user's still-current task. If a new onboarding task was
      // written while the request was in flight, leave the new task untouched.
      const latest = readState();
      if (
        latest.companionId === companionId
        && latest.companionSyncUserId === userId
      ) {
        delete latest.companionId;
        delete latest.companionSyncUserId;
        delete latest.companionSyncAttempts;
        delete latest.companionSyncNextRetryAtMs;
        writeState(latest);
      }
      return true;
    } catch (err) {
      const latest = readState();
      if (
        latest.companionId === companionId
        && latest.companionSyncUserId === userId
      ) {
        const attempts = (latest.companionSyncAttempts ?? 0) + 1;
        const retryDelay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
        writeState({
          ...latest,
          companionSyncAttempts: attempts,
          companionSyncNextRetryAtMs: Date.now() + retryDelay,
        });
      }
      const errorLike = err && typeof err === 'object'
        ? err as { name?: unknown; message?: unknown; cause?: unknown }
        : null;
      const causeLike = errorLike?.cause && typeof errorLike.cause === 'object'
        ? errorLike.cause as { name?: unknown }
        : null;
      const wasAborted = errorLike?.name === 'AbortError' || causeLike?.name === 'AbortError';
      if (wasAborted) {
        console.warn('[onboarding] completion sync exceeded 30s; pending task retained');
      } else {
        console.warn(
          '[onboarding] completion sync failed; pending task retained:',
          typeof errorLike?.message === 'string' ? errorLike.message : err,
        );
      }
      return false;
    } finally {
      clearTimeout(timeout);
    }
  })();
  companionSyncs.set(userId, request);
  void request.finally(() => {
    if (companionSyncs.get(userId) === request) companionSyncs.delete(userId);
  });
  return request;
}

function writeState(state: OnboardingState): void {
  storage.set(kOnboardingState.name, JSON.stringify(state));
}

export function setBunnyName(name: string): void {
  writeState({ ...readState(), bunnyName: name.trim().slice(0, 30) });
}

export function getBunnyName(): string | null {
  return readState().bunnyName ?? null;
}

export function setOnboardingChoices(who: string, blocker: string): void {
  writeState({ ...readState(), whoChoice: who, blockerChoice: blocker });
}
