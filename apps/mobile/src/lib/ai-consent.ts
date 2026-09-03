/**
 * AI consent state management — Stage 6.
 *
 * Three-stage gate before any AI-touching flow (mic record, offer
 * wisdom from Discover, offer wisdom from Seek-question detail):
 *
 *   1. requireAiConsent(nextPath) reads MMKV cache synchronously.
 *      - If consented: returns true; caller proceeds with next flow.
 *      - If NOT consented: router.push to /(main)/(modals)/ai-consent
 *        with `next` query param; returns false. Caller must NOT
 *        continue the original flow.
 *
 *   2. The consent modal does its UI thing. On Agree & Continue:
 *      POST /api/ai-consent (server-side mark), then write MMKV cache,
 *      then router.replace(next) to land on the original target with
 *      a clean stack (no consent modal lingering as a back step).
 *
 *   3. On subsequent app launches, character-state GET response
 *      includes aiConsentAt. fetchCharacterState writes that into
 *      MMKV via setAiConsentFromServer so MMKV stays authoritative
 *      across devices (e.g. user reinstalls, signs in on iPad).
 *
 * MMKV key: 'novame.ai_consent' — JSON shape { agreedAt: ISO string }.
 * NULL / missing means not consented. We never store a "denied" state;
 * the modal is re-shown on every flow trigger until the user agrees,
 * matching Q5 from the design decisions ("X close does not persist").
 */
import { router } from 'expo-router';
import { haptics } from './haptics';

import { storage } from './storage';
import { apiClient } from './api';

const STORAGE_KEY = 'novame.ai_consent';

type CachedConsent = {
  /** ISO timestamp when the user agreed. */
  agreedAt: string;
};

/**
 * Synchronous MMKV check. Returns true if a consent record exists.
 * Used by requireAiConsent + the consent modal to short-circuit if
 * a stale MMKV write somehow predates a server clear (shouldn't
 * happen — consent is set-once — but defensive).
 */
export function hasAiConsented(): boolean {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as CachedConsent;
    return Boolean(parsed.agreedAt);
  } catch {
    return false;
  }
}

/**
 * Called by fetchCharacterState whenever the server returns a fresh
 * aiConsentAt. Writes to MMKV if the server says yes; clears if the
 * server says no (only matters if someone manually NULLs the column
 * in supabase admin — production users never see a clear path).
 *
 * Cross-device sync mechanism: user agrees on iPhone -> server is
 * source of truth -> iPad's next character-state fetch sees the new
 * aiConsentAt and writes its own MMKV. No explicit consent sync API
 * needed because character-state runs on every cold start anyway.
 */
export function setAiConsentFromServer(serverIso: string | null): void {
  if (serverIso) {
    storage.set(STORAGE_KEY, JSON.stringify({ agreedAt: serverIso }));
  } else {
    storage.remove(STORAGE_KEY);
  }
}

/**
 * Mark consent on the server and locally. Called by the consent
 * modal's Agree & Continue button. Returns true on success.
 *
 * The server endpoint is idempotent (POST to an already-consented
 * profile returns the original timestamp), so retry after a
 * transient network failure is safe. We only write MMKV on
 * confirmed server success, otherwise a flaky network could leave
 * the local cache out of sync with the source of truth.
 */
export async function markAiConsent(
  userId: string,
): Promise<{ success: boolean; agreedAt?: string; error?: string }> {
  try {
    const data = await apiClient.post<{
      success: boolean;
      aiConsentAt?: string;
      error?: string;
    }>('/api/ai-consent', { userId });

    if (!data.success || !data.aiConsentAt) {
      return { success: false, error: data.error ?? 'unknown server error' };
    }

    storage.set(
      STORAGE_KEY,
      JSON.stringify({ agreedAt: data.aiConsentAt }),
    );

    return { success: true, agreedAt: data.aiConsentAt };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'network error',
    };
  }
}

/**
 * Gate any AI-touching flow. Call this BEFORE router.push to the
 * target route. Returns true if the caller may proceed; false if
 * the consent modal was pushed and the caller must abort the
 * current action.
 *
 * Pattern at every call site:
 *   const proceed = requireAiConsent(targetUrl);
 *   if (!proceed) return;
 *   router.push(targetUrl);
 *
 * After the user agrees in the modal, it will router.replace(next)
 * to the target on its own. The caller's `if (!proceed) return`
 * is critical — without it, the caller would ALSO push the target
 * after the modal pushed, producing a double-stack.
 *
 * `next` is the full URL string including any query params (the
 * record overlay takes params for forceKeyword / questionId etc).
 */
export function requireAiConsent(
  next: string,
  options?: { cancelTo?: string },
): boolean {
  if (hasAiConsented()) return true;
  // expo-router v6 typed routes do not accept arbitrary query strings
  // in the path; use the object form with separate params instead.
  // The modal reads `next` via useLocalSearchParams and feeds it to
  // router.replace after the user agrees.
  void haptics.pageOpen();
  router.push({
    pathname: '/(main)/ai-consent',
    params: { next, ...(options?.cancelTo ? { cancelTo: options.cancelTo } : {}) },
  });
  return false;
}

/**
 * Clear consent. Only used in tests / dev tools — production has no
 * UI surface to revoke. Exported for completeness.
 */
export function clearAiConsent(): void {
  storage.remove(STORAGE_KEY);
}
