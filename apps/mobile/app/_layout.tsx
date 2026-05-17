
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import { ThemeProvider } from '@/theme';
import { supabase } from '@/lib/supabase';
import { getCurrentSession } from '@/lib/auth';
import { initIAP, cleanupIAP } from '@/lib/iap';
import { syncOnboardingIfPending } from '@/lib/onboarding';
import { clearCachedSubscription, fetchSubscriptionTier } from '@/lib/subscription';
import { clearCachedMeStats, fetchMeStats } from '@/lib/me-stats';
import { clearCachedCharacterState, fetchCharacterState } from '@/lib/character-state';
import { clearSkinUnlockTracker } from '@/lib/skin-unlock-tracker';
import { clearSkinUnlockQueue } from '@/lib/skin-unlock-store';
import { storage } from '@/lib/storage';

// Per expo-splash-screen official docs: call preventAutoHideAsync in
// the global scope of the module that owns the root component, NOT
// inside a React effect. Doing it inside an effect can run too late
// (after the splash has already auto-hidden when the first component
// mounted), defeating the purpose.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Silent — if it returns false the splash was already hidden, which
  // is fine; we just skip the manual hide path.
});

// Hard timeout on cold-start prewarm. Per Apple App Store guidance and
// the expo docs, the splash must hide within a few seconds even if
// network fetches hang — otherwise the user is trapped staring at a
// static screen. 3 seconds is the standard Expo / RN community value.
const PREWARM_TIMEOUT_MS = 3000;

/**
 * Root layout for @novame/mobile.
 *
 * Provider tree (outer to inner) — D7 decision A (minimum set):
 *   GestureHandlerRootView    — gesture root (must be outermost)
 *   SafeAreaProvider          — safe area inset calculation
 *   ThemeProvider             — day/night theme via @novame/ui-tokens
 *   <Stack />                 — expo-router file-based routes
 *
 * Stage 4 will add QueryClientProvider for optimistic updates.
 * Stage 3 may add expo-splash-screen prevent/hide control (B14).
 *
 * The global.css import is required by NativeWind v5 — it loads
 * Tailwind utilities and the @theme block defined in mobile root.
 *
 * ----
 * Stage 3.4 — Auth state lifecycle:
 *
 * 1. AppState listener:
 *    - When app comes to foreground → supabase.auth.startAutoRefresh()
 *    - When app goes background → supabase.auth.stopAutoRefresh()
 *    - This is the Supabase-recommended pattern for React Native;
 *      it prevents token refreshes from running while the app is
 *      backgrounded (saves battery, avoids stale state on resume).
 *
 * 2. onAuthStateChange listener (global lifecycle):
 *    - SIGNED_IN  → router.replace to /(main)/(tabs)
 *    - SIGNED_OUT → router.replace to /(auth)/sign-in
 *    - This is what makes sign-out from any screen (e.g. Me page)
 *      automatically navigate back to auth. Individual screens do
 *      not call router themselves on auth changes.
 *    - INITIAL_SESSION fires once on startup; we ignore it here
 *      because app/index.tsx handles startup redirect explicitly
 *      via getCurrentSession() (avoids race between this listener
 *      and the initial Redirect).
 */
export default function RootLayout() {
  // Cold-start prewarm gate. Stays false until either:
  //   - All three critical fetches resolve (character state, tier, me-stats), or
  //   - PREWARM_TIMEOUT_MS elapses (safety net for slow networks).
  // While false, RootLayout returns null so the native splash stays
  // visible. When true, hideAsync() runs and the app renders its
  // first real frame with hot caches.
  //
  // Sign-in flow is unaffected: that path goes through
  // /(auth)/signing-in which does its own prewarm. This gate only
  // covers cold starts (process launch), where INITIAL_SESSION is
  // a no-op on the onAuthStateChange listener.
  const [isReady, setIsReady] = useState(false);

  // Cold-start prewarm. Runs once on mount, independent of the
  // auth-state-change effect below. Promise.allSettled (not all)
  // so one slow / failing fetch doesn't drag the others. The
  // timeout race guarantees splash hide within PREWARM_TIMEOUT_MS
  // even if all fetches hang.
  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) setIsReady(true);
    };

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        console.warn('[layout] cold-start prewarm timeout, hiding splash anyway');
      }
      finish();
    }, PREWARM_TIMEOUT_MS);

    void (async () => {
      try {
        const session = await getCurrentSession();
        const userId = session?.user?.id;
        if (userId) {
          // Three caches the home tab + me page read on first render.
          // allSettled: missing data falls back to local cache or
          // sensible defaults, doesn't block navigation.
          await Promise.allSettled([
            fetchCharacterState(userId),
            fetchSubscriptionTier(userId),
            fetchMeStats(userId),
          ]);
        }
        // Sessionless cold start (onboarding incomplete or signed out):
        // nothing to prewarm; finish immediately so app/index.tsx can
        // redirect to (onboarding) or (auth)/sign-in.
      } catch (e) {
        console.warn('[layout] cold-start prewarm error:', e);
      } finally {
        clearTimeout(timeoutId);
        finish();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  // Hide the native splash once we're ready. Separate effect from
  // the prewarm itself so React re-renders the JSX (return <Stack />)
  // before hideAsync triggers — avoids a 1-frame blank window between
  // splash hide and first paint.
  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync().catch(() => {
        // Already hidden (e.g. preventAutoHideAsync returned false on
        // start). Nothing to do.
      });
    }
  }, [isReady]);

  useEffect(() => {
    // ---- AppState: control auto-refresh based on foreground/background ----
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };
    // Run once on mount to set the initial state correctly.
    handleAppStateChange(AppState.currentState);
    // Stage 5.IAP.2: register global StoreKit 2 purchase listener.
    void initIAP();

    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    // ---- onAuthStateChange: drive navigation on sign-in / sign-out ----
    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        // Stage 5.WR.2 (cache-stale fix): defensively clear per-user
        // MMKV caches on SIGNED_IN, not just SIGNED_OUT. The
        // SIGNED_OUT-only handler doesn't cover edge cases like:
        //   - User force-quits the app instead of signing out
        //   - User switches accounts after expo-dev-client hot restart
        //   - Apple Sign In re-authenticates as a different user
        // In all of these, the previous user's cached subscription /
        // me-stats / character-state would render for ~20 seconds
        // until the first authoritative fetch returns. Clearing on
        // SIGNED_IN guarantees the UI starts blank for the new user.
        //
        // We do NOT clear onboarding_state / shipping here:
        //   - onboarding_state: in-progress draft scoped to the new
        //     user (a brand-new account has none yet; a returning
        //     mid-onboarding user gets to resume).
        //   - shipping: physical address, doesn't affect any auth-
        //     gated UI and survives the user switch deliberately.
        try {
          clearCachedSubscription();
          clearCachedMeStats();
          clearCachedCharacterState();
        } catch (e) {
          console.warn('[layout] sign-in cache clear failed:', e);
        }

        // Fire-and-forget onboarding sync if there is pending mmkv data
        // from a fresh onboarding completion. Errors are logged and
        // swallowed inside syncOnboardingIfPending so navigation never
        // blocks. Stage 3.5 (B40) deferred this from 3.4 step 5.
        if (session?.user?.id) {
          void syncOnboardingIfPending(session.user.id);
        }
        // Stage 5.WR.2 (Bug 2 fix): route through signing-in screen
        // so it can prewarm character-state / subscription / me-stats
        // before home renders. Avoids the "Loading..." speech bubble
        // and missing Me page header on first frame after sign-in.
        router.replace('/(auth)/signing-in');
      } else if (event === 'SIGNED_OUT') {
        // Stage 5.IAP.5 (Bug #5): clear all per-user MMKV caches so
        // the next user (or fresh sign-in) does not see stale data
        // from the previous user. Per Supabase official guidance for
        // SIGNED_OUT: 'Use this to clean up any local storage your
        // application has associated with the user.'
        try {
          clearCachedSubscription();
          clearCachedMeStats();
          clearCachedCharacterState();
          // Stage 5.WR.2 (Bug 3): clear skin-unlock tracker so a fresh
          // user on the same device starts with no "already seen"
          // history. Also drain the in-memory queue so leftover
          // modals from the prior session don't flash on sign-in.
          clearSkinUnlockTracker();
          clearSkinUnlockQueue();
          // Onboarding cache: scoped to the previous user's uncommitted
          // onboarding draft. Safe to clear unconditionally.
          storage.remove('novame_onboarding_state');
          // Shipping form cache: address belongs to the previous user.
          storage.remove('novame.shipping');
        } catch (e) {
          console.warn('[layout] sign-out cache clear failed:', e);
        }
        router.replace('/(auth)/sign-in');
      }
      // INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED: no-op here.
    });

    return () => {
      appStateSub.remove();
      authSub.unsubscribe();
      void cleanupIAP();
    };
  }, []);

  // While prewarm runs, return null so React doesn't render the
  // app tree. The native splash (kept visible by preventAutoHideAsync)
  // remains on screen. Per expo-splash-screen official example, this
  // is the canonical pattern.
  if (!isReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </ThemeProvider>
        </SafeAreaProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
