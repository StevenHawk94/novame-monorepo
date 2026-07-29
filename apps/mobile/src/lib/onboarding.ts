/**
 * Onboarding companion selection + sync (C4).
 *
 * The user picks a pet during the pre-auth onboarding, before they have an
 * account. There is no user_id yet, so the choice is stashed locally under the
 * preauth-scoped kOnboardingState. On first sign-in, signing-in.tsx calls
 * syncOnboardingCompanion, which reads that choice and creates the companion
 * row server-side (companions requires a user_id the pre-auth flow didn't have).
 *
 * The API is idempotent, so syncing twice is harmless: the first call creates
 * the companion, later calls no-op. We clear the local choice after a
 * successful sync so a returning user doesn't re-send it.
 */
import { apiClient } from './api';
import { kOnboardingIntroSeen, kOnboardingState } from '../shared/storage/keys';
import { storage } from './storage';

export type CompanionId = 'pet1' | 'pet2' | 'pet3';

interface OnboardingState {
  companionId?: CompanionId;
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

/** Persist the chosen pet locally (pre-auth, before we have a user_id). */
export function setChosenCompanion(companionId: CompanionId): void {
  const state = readState();
  state.companionId = companionId;
  storage.set(kOnboardingState.name, JSON.stringify(state));
}

/** The pet chosen during onboarding, if any. */
export function getChosenCompanion(): CompanionId | null {
  return readState().companionId ?? null;
}

/**
 * Sync the locally chosen companion to the server on first sign-in. No-ops if
 * nothing was chosen (a returning user, or one who signed in without going
 * through the new onboarding). Idempotent server-side; clears the local choice
 * on success so it isn't re-sent on later launches.
 */
export async function syncOnboardingCompanion(userId: string): Promise<void> {
  const companionId = getChosenCompanion();
  if (!companionId) return;

  try {
    await apiClient.post('/api/onboarding-complete', { userId, companionId });
    // Clear only on success; a failed sync stays pending for the next sign-in.
    const state = readState();
    delete state.companionId;
    storage.set(kOnboardingState.name, JSON.stringify(state));
  } catch (err) {
    // Fire-and-forget: signing-in must not block on this. A pending choice is
    // retried next launch, and Reflect fails loud if the companion is missing.
    console.warn('[onboarding] companion sync failed, will retry:', err instanceof Error ? err.message : err);
  }
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
