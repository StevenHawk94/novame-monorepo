import { apiClient } from './api';
import { supabase } from './supabase';

/**
 * Account-related mutation wrappers — Stage 3.10.2 (C1).
 *
 * Thin typed facade over four server endpoints used by the Account
 * Management overlay:
 *   POST /api/upload-avatar     (multipart, has Vision SafeSearch)
 *   POST /api/update-profile    (display_name and onboarding profile fields)
 *   POST /api/delete-account    (cascading delete, server-side)
 *
 * Why a wrapper layer:
 *   - Each call has a non-trivial response shape (avatar's UNSAFE_CONTENT
 *     code, update-profile's variant returns) -- typing it once here
 *     keeps the overlay component readable.
 *   - mobile invalidates the me-stats cache after avatar / display name
 *     changes; centralizing those side-effects is overlay business, not
 *     wrapper business -- the wrapper just returns parsed data.
 */

// ---- avatar upload ----

export type AvatarUploadResult =
  | { kind: 'success'; avatarUrl: string }
  | { kind: 'unsafe'; reason: string }
  | { kind: 'error'; message: string };

/**
 * Uploads a local image to /api/upload-avatar via multipart form-data.
 * The server runs Google Cloud Vision SafeSearch and rejects unsafe
 * images with code 'UNSAFE_CONTENT' -- we surface that as a distinct
 * result kind so the UI can show a yellow warning instead of a red error.
 *
 * On success, the server has already updated profiles.avatar_url and
 * cleared is_default_avatar; the caller should then invalidate the
 * me-stats cache so the new URL surfaces on the Me page.
 */
export async function uploadAvatar(
  userId: string,
  imageUri: string,
  mimeType: string = 'image/jpeg',
): Promise<AvatarUploadResult> {
  const fd = new FormData();
  // React Native FormData blob shape -- expo-image-picker returns a
  // file:// uri. The runtime wraps this into a multipart part with
  // the right boundary headers; the server reads it via
  // formData.get('image').
  fd.append('image', {
    uri: imageUri,
    name: 'avatar.jpg',
    type: mimeType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  fd.append('userId', userId);

  type WireResponse =
    | { success: true; avatarUrl: string }
    | { success: false; error: string; reason?: string; code?: string };

  try {
    const data = await apiClient.post<WireResponse>('/api/upload-avatar', fd);
    if (data.success) return { kind: 'success', avatarUrl: data.avatarUrl };
    if (data.code === 'UNSAFE_CONTENT') {
      return { kind: 'unsafe', reason: data.reason || 'Image rejected' };
    }
    return { kind: 'error', message: data.error || 'Upload failed' };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}

// ---- profile field updates ----

type UpdateProfileWire =
  | { success: true; profile?: unknown; message?: string }
  | { success?: false; error: string };

export type UpdateResult =
  | { kind: 'success'; message?: string }
  | { kind: 'error'; message: string };

async function postUpdate(body: Record<string, unknown>): Promise<UpdateResult> {
  try {
    const data = await apiClient.post<UpdateProfileWire>('/api/update-profile', body);
    if (data.success === true) {
      return { kind: 'success', message: data.message };
    }
    return { kind: 'error', message: (data as { error: string }).error || 'Update failed' };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}

export function updateDisplayName(
  userId: string,
  displayName: string,
): Promise<UpdateResult> {
  return postUpdate({ userId, displayName });
}

/** Onboarding funnel answers — fire-and-forget analytics write. */
export function reportOnboardingChoices(
  userId: string,
  who: string,
  blocker: string,
): Promise<UpdateResult> {
  return postUpdate({ userId, onboardingWho: who, onboardingBlocker: blocker });
}

export function updateEmail(
  userId: string,
  newEmail: string,
  nonce: string,
): Promise<UpdateResult> {
  return updateAuthUser(userId, { email: newEmail, nonce }, 'Verification email sent');
}

export async function requestAccountReauthentication(): Promise<UpdateResult> {
  try {
    const { error } = await supabase.auth.reauthenticate();
    if (error) return { kind: 'error', message: error.message };
    return { kind: 'success', message: 'Verification code sent' };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Could not send verification code' };
  }
}

async function updateAuthUser(
  userId: string,
  attributes: { email: string; nonce: string },
  successMessage: string,
): Promise<UpdateResult> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.user?.id !== userId) {
      return { kind: 'error', message: 'Please sign in again' };
    }
    const { error } = await supabase.auth.updateUser(attributes);
    if (error) return { kind: 'error', message: error.message };
    return { kind: 'success', message: successMessage };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Update failed' };
  }
}

// ---- delete account ----

export type DeleteAccountResult =
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  try {
    type WireResponse = { success: boolean; message?: string; error?: string };
    const data = await apiClient.post<WireResponse>('/api/delete-account', {
      userId,
    });
    if (data.success) return { kind: 'success' };
    return { kind: 'error', message: data.error || 'Failed to delete account' };
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Network error',
    };
  }
}
