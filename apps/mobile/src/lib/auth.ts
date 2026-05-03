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
