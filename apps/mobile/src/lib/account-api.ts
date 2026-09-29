import { apiClient } from './api';
import { supabase } from './supabase';

/**
 * Account-related mutation wrappers — Stage 3.10.2 (C1).
 *
 * Thin typed facade over the server endpoints used by the Account
 * Management overlay:
 *   POST /api/update-profile    (display_name, bundled avatar and onboarding fields)
 *   POST /api/delete-account    (cascading delete, server-side)
 *
 * Why a wrapper layer:
 *   - mobile invalidates the me-stats cache after avatar / display name
 *     changes; centralizing those side-effects is overlay business, not
 *     wrapper business -- the wrapper just returns parsed data.
 */

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

export function updateOnboardingProfile(
  userId: string,
  fields: {
    displayName: string;
    birthday: string;
    defaultAvatarId?: string;
    partnerName?: string;
    partnerPronouns?: string;
    partnerNickname?: string;
    relationshipSince?: string;
  },
): Promise<UpdateResult> {
  return postUpdate({ userId, ...fields });
}

export function updateDefaultAvatar(
  userId: string,
  defaultAvatarId: string,
): Promise<UpdateResult> {
  return postUpdate({ userId, defaultAvatarId });
}

type AvatarUploadWire =
  | { success: true; avatarUrl: string }
  | { success?: false; error: string };

type AvatarPrepareWire =
  | { success: true; path: string; token: string }
  | { success?: false; error: string };

export type AvatarUploadResult =
  | { kind: 'success'; avatarUrl: string }
  | { kind: 'error'; message: string };

export async function uploadProfileAvatar(
  userId: string,
  image: { base64: string; mimeType: string },
): Promise<AvatarUploadResult> {
  try {
    const data = await apiClient.post<AvatarUploadWire>('/api/upload-avatar', {
      userId,
      ...image,
    });
    if (data.success === true) {
      return { kind: 'success', avatarUrl: data.avatarUrl };
    }
    return { kind: 'error', message: (data as { error: string }).error || 'Upload failed' };
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export async function prepareProfileAvatarUpload(
  userId: string,
): Promise<{ kind: 'success'; path: string; token: string } | { kind: 'error'; message: string }> {
  try {
    const data = await apiClient.post<AvatarPrepareWire>('/api/upload-avatar', {
      action: 'prepare',
      userId,
    });
    if (data.success === true) {
      return { kind: 'success', path: data.path, token: data.token };
    }
    return { kind: 'error', message: (data as { error: string }).error || 'Upload failed' };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Network error' };
  }
}

export async function completeProfileAvatarUpload(
  userId: string,
  path: string,
): Promise<AvatarUploadResult> {
  try {
    const data = await apiClient.post<AvatarUploadWire>('/api/upload-avatar', {
      action: 'complete',
      userId,
      path,
    });
    if (data.success === true) {
      return { kind: 'success', avatarUrl: data.avatarUrl };
    }
    return { kind: 'error', message: (data as { error: string }).error || 'Upload failed' };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'Network error' };
  }
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
