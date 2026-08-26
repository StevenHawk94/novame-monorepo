import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import type { AuthError, Session, User } from '@supabase/supabase-js';

import { supabase } from './supabase';

/**
 * Authentication wrappers around Supabase auth.
 *
 * Authentication is passwordless: Apple, Google, or a six-digit email OTP.
 *
 * All functions return a discriminated result `{ data, error }` instead
 * of throwing — caller decides between Alert / inline error / silent retry.
 *
 * Supabase auth state lives in the supabase singleton. This file does
 * NOT manage React state; consumers use supabase.auth.onAuthStateChange
 * (set up in app/_layout.tsx) to react to sign-in / sign-out events.
 */

// ---- types ----

export type SignOutResult = {
  error: AuthError | null;
};

/**
 * Confirms an email-change 6-digit code (Connect Account flow: an anonymous
 * user attaches an email via updateUser({email}), Supabase mails the code,
 * this verifies it and completes the binding).
 */
async function verifyEmailChangeOtp(
  email: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email_change',
  });
  return error ? { ok: false, error: error.message } : { ok: true };
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

type AppleIdTokenResult =
  | { kind: 'success'; token: string; nonce: string }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

/**
 * Opens the native Apple sheet exactly once and returns the credential needed
 * by either Supabase's linkIdentity or signInWithIdToken endpoint.
 */
async function requestAppleIdToken(): Promise<AppleIdTokenResult> {
  if (Platform.OS !== 'ios') {
    return { kind: 'unsupported' };
  }

  const isAvailable = await AppleAuthentication.isAvailableAsync();
  if (!isAvailable) {
    return { kind: 'unsupported' };
  }

  const rawNonce = randomUUID();
  const hashedNonce = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

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

  return {
    kind: 'success',
    token: credential.identityToken,
    nonce: rawNonce,
  };
}

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
  const credential = await requestAppleIdToken();
  if (credential.kind !== 'success') return credential;

  // 4. Hand off to Supabase with RAW nonce
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.token,
    nonce: credential.nonce,
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
// ---- OAuth: Google ----

/**
 * Result of a Google Sign-In attempt.
 *
 * Mirrors AppleSignInResult shape so callers can pattern-match on .kind
 * and route to the same UI affordances (cancelled = silent, others = inline).
 */
export type GoogleSignInResult =
  | { kind: 'success'; session: Session; user: User }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

let googleSigninConfigured = false;

/**
 * Configures the GoogleSignin SDK once per process.
 *
 * Must be called before signInAsync. We do it lazily inside
 * signInWithGoogle so the SDK is never initialized if the user
 * never taps the Google button (saves startup time).
 *
 * Reads from EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID. Both must be set in
 * apps/mobile/.env.local — see .env.example for placeholders.
 *
 * webClientId is required even on iOS — Google's SDK uses it as the
 * audience for the returned idToken. Without it, the idToken's aud
 * field would be the iOS client ID and Supabase would reject it
 * (Supabase verifies idToken aud against its Authorized Client IDs;
 * we have all three Client IDs registered there, but using webClientId
 * follows the recommended pattern).
 */
function configureGoogleSignin(): void {
  if (googleSigninConfigured) return;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. Add it to apps/mobile/.env.local.',
    );
  }
  GoogleSignin.configure({
    webClientId,
    iosClientId,
    scopes: ['email', 'profile'],
  });
  googleSigninConfigured = true;
}

/**
 * Signs in (or up) with Google via the native Google Sign-In sheet.
 *
 * Flow (verified against Supabase official docs + RN-google-signin
 * security guide):
 *   1. configure() once with webClientId + iosClientId.
 *   2. hasPlayServices() check on Android (no-op on iOS).
 *   3. signIn() shows the Google account picker. Returns idToken on success.
 *   4. supabase.auth.signInWithIdToken({ provider: 'google', token }).
 *   5. NO nonce passed because Google iOS SDK skips nonce by default and
 *      Supabase has Skip Nonce Check enabled for the Google provider.
 *   6. Supabase verifies idToken signature + aud matches one of the
 *      Authorized Client IDs (Web/iOS/Android) → returns session.
 *   7. onAuthStateChange listener in app/_layout.tsx fires SIGNED_IN
 *      and routes the user to (main)/(tabs).
 *
 * NOT done here:
 *   - prebuild + run:ios verification: deferred to stage 5/6 real-device
 *     testing (per user decision; native Google sign-in flow needs
 *     Google Cloud Console SHA-1 fingerprint validation that is best
 *     done on actual hardware).
 *   - Apple-style nonce dance: not needed because Skip Nonce Check
 *     is enabled in Supabase dashboard.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  try {
    configureGoogleSignin();
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : 'Google sign-in not configured',
    };
  }

  try {
    // hasPlayServices: required on Android, no-op on iOS.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (e) {
    return {
      kind: 'unsupported',
    };
  }

  let response: Awaited<ReturnType<typeof GoogleSignin.signIn>>;
  try {
    response = await GoogleSignin.signIn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === statusCodes.SIGN_IN_CANCELLED) {
      return { kind: 'cancelled' };
    }
    if (err.code === statusCodes.IN_PROGRESS) {
      return { kind: 'error', message: 'Sign-in already in progress.' };
    }
    if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { kind: 'unsupported' };
    }
    return {
      kind: 'error',
      message: err.message ?? 'Google sign-in failed',
    };
  }

  // SDK v14+ returns { type: 'success' | 'cancelled', data: {...} }.
  if (response.type === 'cancelled') {
    return { kind: 'cancelled' };
  }
  const idToken = response.data?.idToken;
  if (!idToken) {
    return {
      kind: 'error',
      message: 'No idToken returned from Google.',
    };
  }

  // Hand off to Supabase. No nonce passed — Skip Nonce Check is enabled
  // in the Supabase dashboard for the Google provider.
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) {
    return { kind: 'error', message: error.message };
  }
  if (!data.session || !data.user) {
    return {
      kind: 'error',
      message: 'Google sign-in succeeded but no session returned.',
    };
  }
  return { kind: 'success', session: data.session, user: data.user };
}


/**
 * Guest mode (2026-07-26): the app no longer requires an account. If there is
 * no session, create an ANONYMOUS one — every downstream system (profiles,
 * RPCs, RLS) sees a normal user id. "Connect Your Account" later attaches a
 * real identity to this same user, so nothing is lost.
 *
 * Requires "Anonymous sign-ins" to be ENABLED in Supabase Auth settings.
 * Returns false when no session could be established (feature off / offline)
 * — the caller falls back to the standalone passwordless recovery screen.
 */
let ensureSessionInFlight: Promise<boolean> | null = null;

export async function ensureSession(): Promise<boolean> {
  const existing = await getCurrentSession();
  if (existing) return true;

  // App bootstrap, onboarding and the paywall can all request a guest session
  // at nearly the same time. Serialize anonymous sign-in so those callers can
  // never mint competing UUIDs for the same local installation.
  if (ensureSessionInFlight) return ensureSessionInFlight;

  ensureSessionInFlight = (async () => {
    try {
      // Re-check after acquiring the module-level lock: another caller may
      // have completed anonymous sign-in between the first read and now.
      const restored = await getCurrentSession();
      if (restored) return true;

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn('[auth] anonymous sign-in failed:', error.message);
        return false;
      }
      return Boolean(data.session);
    } catch (err) {
      console.warn('[auth] anonymous sign-in threw:', err instanceof Error ? err.message : err);
      return false;
    }
  })();

  try {
    return await ensureSessionInFlight;
  } finally {
    ensureSessionInFlight = null;
  }
}

// ---- Anonymous-account linking (onboarding "Connect Your Account") ----

/**
 * Links the CURRENT (anonymous) session to a provider identity via
 * Supabase's linkIdentity OAuth flow in an auth browser session. This is the
 * supported way to convert a guest without minting a new user (native
 * signInWithIdToken would sign into a different account and orphan the
 * guest's data). Requires the provider to be enabled in the Supabase
 * dashboard with novame://auth-callback in the allowed redirect URLs.
 */
export async function linkIdentityWithProvider(
  provider: 'apple' | 'google',
): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
  try {
    const redirectTo = 'novame://auth-callback';
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) {
      return { ok: false, error: error?.message ?? 'Could not start linking' };
    }
    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success' || !res.url) {
      return { ok: false, cancelled: true };
    }
    const url = new URL(res.url);
    const errDesc = url.searchParams.get('error_description');
    if (errDesc) return { ok: false, error: errDesc };
    const code = url.searchParams.get('code');
    if (code) {
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exErr) return { ok: false, error: exErr.message };
    } else {
      const params = new URLSearchParams(url.hash.replace(/^#/, ''));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
        if (setErr) return { ok: false, error: setErr.message };
      } else {
        // The link may still have landed server-side; pick it up.
        await supabase.auth.refreshSession();
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Linking failed' };
  }
}

// ---- Smart connect: bind, or recover the existing account ----

/**
 * True when a link/updateUser rejection means "this credential already
 * belongs to some account" — the one case where falling back to sign-in
 * is correct. Any other failure (manual linking disabled, network, bad
 * config) must NOT fall through: an id-token sign-in would silently mint
 * a fresh user and orphan the guest\u2019s data.
 */
function isAlreadyBoundError(msg?: string, code?: string): boolean {
  if (code === 'identity_already_exists') return true;
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes('already') && (m.includes('linked') || m.includes('registered') || m.includes('exists') || m.includes('in use'));
}

export type ConnectResult =
  | { ok: true; mode: 'linked' | 'signedIn' }
  | { ok: false; cancelled?: boolean; error?: string };

/**
 * Converts an anonymous Apple user without a second Apple prompt.
 *
 * The same native credential is first offered to linkIdentity, preserving the
 * current guest UUID. Only identity_already_exists means the Apple identity is
 * owned by a previous account; in that case the same token signs into that
 * account, intentionally switching to its UUID without reopening Apple UI.
 */
async function connectAppleProviderOrSignIn(): Promise<ConnectResult> {
  const credential = await requestAppleIdToken();
  if (credential.kind === 'cancelled') return { ok: false, cancelled: true };
  if (credential.kind === 'unsupported') {
    return { ok: false, error: 'Sign-in is not available on this device.' };
  }
  if (credential.kind === 'error') {
    return { ok: false, error: credential.message };
  }

  const { data: linked, error: linkError } = await supabase.auth.linkIdentity({
    provider: 'apple',
    token: credential.token,
    nonce: credential.nonce,
  });
  if (!linkError && linked.session && linked.user) {
    return { ok: true, mode: 'linked' };
  }
  if (!isAlreadyBoundError(linkError?.message, linkError?.code)) {
    return { ok: false, error: linkError?.message ?? 'Could not link Apple account.' };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.token,
    nonce: credential.nonce,
  });
  if (error) return { ok: false, error: error.message };
  if (!data.session || !data.user) {
    return { ok: false, error: 'Apple sign-in succeeded but no session returned.' };
  }
  return { ok: true, mode: 'signedIn' };
}

/**
 * The one-button "Connect" contract (product call 2026-08-07):
 *   1. try to LINK the provider identity to the current (anonymous) user;
 *   2. if the identity already belongs to another account, this is a
 *      returning user \u2014 SIGN IN natively instead, recovering that account
 *      (the freshly-minted empty guest is abandoned, by design).
 */
export async function connectProviderOrSignIn(
  provider: 'apple' | 'google',
): Promise<ConnectResult> {
  const signIn = async (): Promise<ConnectResult> => {
    const res = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
    if (res.kind === 'success') return { ok: true, mode: 'signedIn' };
    if (res.kind === 'cancelled') return { ok: false, cancelled: true };
    return {
      ok: false,
      error: res.kind === 'error' ? res.message : 'Sign-in is not available on this device.',
    };
  };

  // The standalone auth route can be opened without a session. Linking only
  // applies to the guest flow; without an anonymous user this is a normal
  // passwordless sign-in/sign-up.
  const session = await getCurrentSession();
  const isAnonymous = (session?.user as { is_anonymous?: boolean } | undefined)?.is_anonymous ?? false;
  if (!isAnonymous) return signIn();

  // Native Apple ID-token linking lets one credential handle both possible
  // outcomes, so the user never sees a browser sheet followed by Apple again.
  if (provider === 'apple') return connectAppleProviderOrSignIn();

  const link = await linkIdentityWithProvider(provider);
  if (link.ok) return { ok: true, mode: 'linked' };
  if (link.cancelled) return { ok: false, cancelled: true };
  if (!isAlreadyBoundError(link.error)) return { ok: false, error: link.error };
  return signIn();
}

export type PasswordlessEmailMode = 'change' | 'login';

/**
 * Starts the unified email OTP flow.
 * - anonymous session: bind the address to this exact user; if it already
 *   belongs to an account, send a login code to recover that account.
 * - no/non-anonymous session: one OTP signs in an existing address or creates
 *   a new account. No password credential is created.
 */
export async function sendPasswordlessEmailOtp(
  email: string,
): Promise<{ ok: boolean; mode?: PasswordlessEmailMode; error?: string }> {
  const session = await getCurrentSession();
  const isAnonymous = (session?.user as { is_anonymous?: boolean } | undefined)?.is_anonymous ?? false;

  if (isAnonymous) {
    const { error } = await supabase.auth.updateUser({ email });
    if (!error) return { ok: true, mode: 'change' };
    if (!isAlreadyBoundError(error.message)) return { ok: false, error: error.message };
    const login = await sendLoginEmailOtp(email);
    return login.ok
      ? { ok: true, mode: 'login' }
      : { ok: false, error: login.error };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  return error
    ? { ok: false, error: error.message }
    : { ok: true, mode: 'login' };
}

export async function verifyPasswordlessEmailOtp(
  email: string,
  token: string,
  mode: PasswordlessEmailMode,
): Promise<{ ok: boolean; error?: string }> {
  return mode === 'change'
    ? verifyEmailChangeOtp(email, token)
    : verifyLoginEmailOtp(email, token);
}

export async function resendPasswordlessEmailOtp(
  email: string,
  mode: PasswordlessEmailMode,
): Promise<{ ok: boolean; error?: string }> {
  if (mode === 'login') return sendLoginEmailOtp(email);
  const { error } = await supabase.auth.resend({ type: 'email_change', email });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Login-code request for the email fallback (existing accounts only). */
async function sendLoginEmailOtp(email: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Confirms a login code (verifyOtp type email) \u2014 restores the old account. */
async function verifyLoginEmailOtp(
  email: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  return error ? { ok: false, error: error.message } : { ok: true };
}
