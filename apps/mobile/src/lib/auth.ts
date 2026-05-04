import * as AppleAuthentication from 'expo-apple-authentication';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import type { AuthError, Session, User } from '@supabase/supabase-js';

import { supabase } from './supabase';

/**
 * Authentication wrappers around Supabase auth.
 *
 * Stage 3.4 covers Email password (this file). Apple Sign-In and Google
 * Sign-In are added in stage 3.4.F / 3.4.G as separate exports.
 *
 * All functions return a discriminated result `{ data, error }` instead
 * of throwing — caller decides between Alert / inline error / silent retry.
 *
 * Supabase auth state lives in the supabase singleton. This file does
 * NOT manage React state; consumers use supabase.auth.onAuthStateChange
 * (set up in app/_layout.tsx) to react to sign-in / sign-out events.
 */

// ---- types ----

export type SignInResult = {
  data: { session: Session | null; user: User | null };
  error: AuthError | null;
};

export type SignUpResult = {
  data: { session: Session | null; user: User | null };
  error: AuthError | null;
  /**
   * True when sign-up succeeded but session is null because Supabase requires
   * email verification. Caller should show "check your inbox" message.
   */
  needsEmailConfirmation: boolean;
};

export type SignOutResult = {
  error: AuthError | null;
};

export type ResetPasswordResult = {
  error: AuthError | null;
};

// ---- email + password ----

/**
 * Signs in an existing user with email and password.
 *
 * Returns the session on success. Caller checks `result.error` for
 * specific failure messages (wrong password, user not found, rate limit).
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<SignInResult> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

/**
 * Signs up a new user with email and password.
 *
 * If Supabase project has email confirmation enabled (default), the
 * returned session will be null and the user must click a link in their
 * email before they can sign in. `needsEmailConfirmation` indicates this.
 *
 * If email confirmation is disabled (test environments), session will be
 * non-null and the user is signed in immediately.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  const needsEmailConfirmation = !error && data.session === null && data.user !== null;
  return { data, error, needsEmailConfirmation };
}

/**
 * Sends a password reset email. Supabase will email the user a link.
 *
 * NOTE: The redirect target on the link must be configured in the
 * Supabase dashboard (Authentication > URL Configuration). For mobile,
 * the redirect should be the app's deep-link scheme (novame://).
 * Stage 3.4.E (deep link handling) will wire this up — until then the
 * link will open in the browser and require the user to copy a token.
 */
export async function sendPasswordReset(email: string): Promise<ResetPasswordResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  return { error };
}

/**
 * Verifies a 6-digit OTP code sent to the user's email after sign-up.
 *
 * Supabase sends the OTP automatically when signUp is called (default
 * behavior when "Confirm email" is enabled in the Supabase dashboard).
 * The user enters this code in the app to complete sign-up; on success,
 * onAuthStateChange fires SIGNED_IN with a fresh session.
 *
 * Type 'signup' = OTP for sign-up confirmation.
 * Other types ('email_change' / 'magiclink') not used in this codebase.
 */
export async function verifyEmailOtp(
  email: string,
  token: string,
): Promise<SignInResult> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'signup',
  });
  return { data, error };
}

// ---- session lifecycle ----

/**
 * Signs out the current user. Clears local session storage.
 */
export async function signOut(): Promise<SignOutResult> {
  const { error } = await supabase.auth.signOut();
  return { error };
}

/**
 * Returns the current session, or null if the user is not signed in.
 *
 * Used during app launch redirect logic. The session is read from local
 * storage (AsyncStorage in our supabase config), so this resolves quickly
 * without a network round-trip.
 *
 * If the session token is expired, supabase-js will attempt to refresh
 * it automatically (autoRefreshToken: true is set in lib/supabase.ts).
 */
export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
// ---- OAuth: Apple ----

/**
 * Result of an Apple Sign-In attempt.
 *
 * Three failure modes are surfaced separately:
 *   - cancelled: user dismissed the Apple sheet
 *   - unsupported: device or platform does not support Sign in with Apple
 *   - error: generic failure (Apple credential issue, Supabase reject)
 *
 * Caller should treat 'cancelled' as a no-op (don't show error) but
 * surface 'unsupported' and 'error' to the user.
 */
export type AppleSignInResult =
  | { kind: 'success'; session: Session; user: User }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

/**
 * Signs in (or up) with Apple via the native iOS Sign in with Apple sheet.
 *
 * Flow (verified against Supabase official docs + multiple production examples):
 *   1. Generate a random nonce (raw form).
 *   2. Hash it with SHA-256 (hex).
 *   3. Pass the HASHED nonce to AppleAuthentication.signInAsync.
 *   4. Pass the RAW nonce to supabase.auth.signInWithIdToken alongside
 *      the identity token Apple returned.
 *   5. Supabase internally hashes the raw nonce and compares with the
 *      nonce embedded in the JWT — they match because both were derived
 *      from the same raw value.
 *
 * If steps 3 and 4 use the same form (both raw or both hashed), the
 * signInWithIdToken call fails with "Passed nonce and nonce in id_token
 * must align".
 *
 * Apple only returns the user's full name and email on the FIRST sign-in
 * for a given Apple ID + app. Subsequent sign-ins return null for those
 * fields. Stage 3.4 ignores name / email beyond what Apple bakes into
 * the identity token; stage 3.5 (onboarding sync) or later may use them.
 *
 * iOS only — Android Apple Sign-In requires a separate OAuth web flow
 * (B21, deferred to stage 5 IAP context).
 */
export async function signInWithApple(): Promise<AppleSignInResult> {
  if (Platform.OS !== 'ios') {
    return { kind: 'unsupported' };
  }

  const isAvailable = await AppleAuthentication.isAvailableAsync();
  if (!isAvailable) {
    return { kind: 'unsupported' };
  }

  // 1. Generate raw nonce
  const rawNonce = randomUUID();

  // 2. Hash it (SHA-256 hex, matching Supabase server-side comparison)
  const hashedNonce = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  // 3. Show Apple sheet with HASHED nonce
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (e) {
    // Expo throws ERR_REQUEST_CANCELED when user dismisses
    if (e instanceof Error && (e as Error & { code?: string }).code === 'ERR_REQUEST_CANCELED') {
      return { kind: 'cancelled' };
    }
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Apple sign-in failed',
    };
  }

  if (!credential.identityToken) {
    return {
      kind: 'error',
      message: 'No identity token returned from Apple.',
    };
  }

  // 4. Hand off to Supabase with RAW nonce
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });

  if (error) {
    return { kind: 'error', message: error.message };
  }
  if (!data.session || !data.user) {
    return {
      kind: 'error',
      message: 'Apple sign-in succeeded but no session returned.',
    };
  }
  return { kind: 'success', session: data.session, user: data.user };
}

