/**
 * Signing-in loading screen (Stage 5.WR.2, new-user instant-home rewrite).
 *
 * Sits between sign-in success and the home tab. After this rewrite it
 * exists primarily to provide a visual transition (purple background +
 * logo + spinner) for ~600ms while data fetches kick off in the
 * background -- it no longer BLOCKS on those fetches.
 *
 * History:
 *   v1 (original Stage 5.WR.2): awaited Promise.allSettled([
 *     fetchCharacterState, fetchSubscriptionTier, fetchMeStats
 *   ]) with a 3s timeout. This worked for established users on fast
 *   networks but had two failure modes:
 *     - New users hit a race between Supabase auth's handle_new_user
 *       trigger (creating profiles row) and character-state route's
 *       ensureProfileFields (re-reading it). Result: HTTP 404 within
 *       ~700ms, fetch rejected, cache stayed null, home displayed
 *       "Loading..." speech bubble.
 *     - Even when no race, the three serial server calls (each with
 *       its own DB round-trips) consistently took 4-5s on cold
 *       Vercel Edge boots, blowing through the 3s timeout. The home
 *       tab then rendered before its caches were populated.
 *
 *   v2 (this version): instant-default pattern, industry-standard
 *   stale-while-revalidate. We write known-correct DEFAULT values to
 *   MMKV immediately (verified to match what the server would return
 *   for a fresh account), navigate to home, and fire fetches in the
 *   background. Reactive polling in home/me/growth picks up the
 *   server-confirmed values within seconds without UI disruption.
 *
 * Why this is correct for new users:
 *   For a newly-signed-up account the server response IS the default
 *   values -- wp=0, level=1, totalCards=1, planTier='free', etc. So
 *   client-side defaulting produces the SAME numbers the fetch would
 *   produce, with zero network wait. The only fields the client
 *   cannot pre-compute are server-side randomness (the default
 *   avatar URL assigned by trigger_assign_default_avatar) which
 *   gracefully renders an empty-string placeholder until the
 *   background fetch lands.
 *
 * Why this is acceptable for returning users:
 *   On sign-in the SIGNED_IN handler in _layout.tsx clears the per-
 *   user caches (to prevent cross-account leakage). The user then
 *   transits this screen; we now populate caches with DEFAULTS for
 *   the ~5s the fetch needs. The user sees Free-tier / level-1 stats
 *   briefly, then the home/me page reactive listeners swap in real
 *   values once fetchCharacterState / fetchMeStats / fetchSubscription
 *   resolve. Slight transient mismatch is acceptable -- returning sign-
 *   in is rare and the user does not interact with stats during the
 *   transition window.
 *
 * displayName / charName:
 *   Read from MMKV onboarding state (set at onboarding step 10 before
 *   sign-in). Carries the user's chosen name into the default cache
 *   so Me page header and Home speech bubble show the right identity
 *   from frame 1.
 *
 * MIN_DISPLAY_MS = 600ms: keeps the splash visible long enough to
 * look intentional (not a one-frame flash). Below this, users feel
 * the transition was glitchy.
 *
 * No PREWARM_TIMEOUT_MS needed anymore -- we never wait on fetches.
 */

import { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { getCurrentSession } from '@/lib/auth';
import {
  DEFAULT_NEW_USER_CHARACTER_STATE,
  fetchCharacterState,
  getCachedCharacterState,
  setCachedCharacterState,
} from '@/lib/character-state';
import {
  fetchSubscriptionTier,
  getCachedSubscription,
  setCachedSubscription,
} from '@/lib/subscription';
import {
  DEFAULT_NEW_USER_ME_STATS,
  fetchMeStats,
  getCachedMeStats,
  setCachedMeStats,
} from '@/lib/me-stats';
import { getOnboardingState } from '@/lib/onboarding';

const LOGO = require('../../assets/images/logo.png');

const MIN_DISPLAY_MS = 600;

export default function SigningInScreen() {
  useEffect(() => {
    const start = Date.now();
    let navigated = false;

    const goHome = () => {
      if (navigated) return;
      navigated = true;
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => {
        router.replace('/(main)/(tabs)');
      }, remaining);
    };

    void (async () => {
      const session = await getCurrentSession();
      const userId = session?.user?.id;
      if (!userId) {
        // No session somehow -- bounce back to sign-in. Should be
        // unreachable in practice (this screen is only entered on
        // sign-in success), but defensive.
        navigated = true;
        router.replace('/(auth)/sign-in');
        return;
      }

      // ---- Step 1: populate caches with DEFAULTS for instant home ----
      //
      // Read onboarding state to inject the user's chosen name into
      // the defaults so Home / Me show the right identity from frame 1.
      const onboarding = getOnboardingState();
      const charName = onboarding.charName || '';

      if (!getCachedCharacterState()) {
        setCachedCharacterState({
          ...DEFAULT_NEW_USER_CHARACTER_STATE,
          charName,
          wpLastFetchedAtMs: Date.now(),
        });
      }
      if (!getCachedMeStats()) {
        setCachedMeStats({
          ...DEFAULT_NEW_USER_ME_STATS,
          displayName: charName,
          lastFetchedAtMs: Date.now(),
        });
      }
      if (!getCachedSubscription()) {
        setCachedSubscription({
          tier: 'free',
          lastFetchedAtMs: Date.now(),
        });
      }

      // ---- Step 2: fire-and-forget background reconcile ----
      //
      // These resolve in 1-5 seconds depending on whether the
      // handle_new_user trigger has finished writing the profile row.
      // Home/Me/Growth tabs poll MMKV every 2s; whichever resolves
      // first repaints the UI silently. Errors are non-fatal -- the
      // default cache stays in place.
      void fetchCharacterState(userId).catch((e) => {
        console.warn('[signing-in] character-state fetch failed:', e?.message || e);
      });
      void fetchSubscriptionTier(userId).catch((e) => {
        console.warn('[signing-in] subscription fetch failed:', e?.message || e);
      });
      void fetchMeStats(userId).catch((e) => {
        console.warn('[signing-in] me-stats fetch failed:', e?.message || e);
      });

      // ---- Step 3: navigate immediately (respects 600ms minimum) ----
      goHome();
    })();
  }, []);

  return (
    <View style={styles.root}>
      <Image source={LOGO} style={styles.logo} resizeMode="contain" />
      <ActivityIndicator
        size="small"
        color="rgba(255,255,255,0.85)"
        style={styles.spinner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 96,
    height: 96,
    marginBottom: 24,
  },
  spinner: {
    marginTop: 4,
  },
});
