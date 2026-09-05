
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AdaptiveAppFrame } from '@/components/layout/adaptive-app-frame';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Font from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
} from '@expo-google-fonts/inter';

import { ThemeProvider } from '@/theme';
import { supabase } from '@/lib/supabase';
import { getCurrentSession } from '@/lib/auth';
import { observeSessionIdentity } from '@/lib/session-lifecycle';
import { hasSeenIntro } from '@/lib/onboarding';
import { initIAP, cleanupIAP, reconcileAvailablePurchases } from '@/lib/iap';
import { fetchSubscriptionTier } from '@/lib/subscription';
import {
  resumeSubscriptionRealtime,
  startSubscriptionRealtime,
  stopSubscriptionRealtime,
} from '@/lib/subscription-realtime';
import {
  resumePairingRealtime,
  startPairingRealtime,
  stopPairingRealtime,
} from '@/lib/pairing-realtime';
import { fetchMeStats } from '@/lib/me-stats';
import { fetchAppConfig } from '@/lib/app-config-api';
import { clearSkinUnlockQueue } from '@/lib/skin-unlock-store';
import { checkForceUpdate } from '@/lib/force-update';
import { ForceUpdateGate } from '@/components/main/force-update-gate';
import { AppDialogHost } from '@/components/ui/app-dialog';
import { ErrorBoundary } from '@/components/main/error-boundary';
import { GoodVibesInboxGate } from '@/components/main/good-vibes';
import { hideSplashOnce } from '@/lib/splash';
import { beginHomeEntry, observeHomeEntryAppState } from '@/lib/home-entry-readiness';
import { captureAnalysisLaunchInactivity } from '@/lib/analysis-refresh-policy';
import { touchActivity } from '@/lib/activity';
import { checkContentVersionInBackground } from '@/lib/content-version';
import { prepareUnreadAnnouncement } from '@/lib/announcements-api';
import {
  pauseDownloadQueue,
  resumeDownloadQueue,
} from '@/lib/download-queue';
import {
  assertAllKeysRegistered,
  purgeLegacyKeys,
  clearOnSignIn,
  clearOnSignOut,
  debugAccountKeysRemaining,
} from '@/shared/storage';
import {
  reconcileDailyReminderSchedule,
  syncRemoteNotificationRegistration,
} from '@/lib/notification-settings';
import { emitHomeRefresh } from '@/lib/home-refresh-signal';
import { warmEntryBackgrounds } from '@/lib/prefetch';
import { MetaPrivacyProvider } from '@/components/privacy/meta-privacy-provider';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Per expo-splash-screen official docs: call preventAutoHideAsync in
// the global scope of the module that owns the root component, NOT
// inside a React effect. Doing it inside an effect can run too late
// (after the splash has already auto-hidden when the first component
// mounted), defeating the purpose.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Silent — if it returns false the splash was already hidden, which
  // is fine; we just skip the manual hide path.
});

// Dev-only. Fails loudly if MMKV holds a key that was never declared in
// src/shared/storage/keys.ts. An undeclared key has no scope, which means
// nothing will ever clear it on sign-out -- the exact shape of P0-1.
purgeLegacyKeys();
assertAllKeysRegistered();

// Hard timeout on cold-start prewarm. Per Apple App Store guidance and
// the expo docs, the splash must hide within a few seconds even if
// network fetches hang — otherwise the user is trapped staring at a
// static screen. 3 seconds is the standard Expo / RN community value.
const PREWARM_TIMEOUT_MS = 3000;

function isWidgetFriendsUrl(url: string | null | undefined): boolean {
  return /^novame:\/\/friends(?:[/?#]|$)/i.test(url ?? '');
}

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
 *    - SIGNED_IN with a different UUID → route into the new account, except
 *      an anonymous UUID prepared while onboarding is still in progress.
 *      Recovery of the same UUID must not reset caches or the current page.
 *    - SIGNED_OUT → router.replace to /(auth)/sign-in
 *    - This is what makes sign-out from any screen (e.g. Me page)
 *      automatically navigate back to auth. Individual screens do
 *      not call router themselves on auth changes.
 *    - INITIAL_SESSION records ownership without navigating;
 *      app/index.tsx handles startup redirect explicitly
 *      via getCurrentSession() (avoids race between this listener
 *      and the initial Redirect).
 */
// Crash reporting: enabled only when a DSN is configured (EAS env /
// .env.local EXPO_PUBLIC_SENTRY_DSN) and never in dev sessions.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: !!SENTRY_DSN && !__DEV__,
  tracesSampleRate: 0.1,
});

function RootLayout() {
  // Must run before AppState/prewarm effects can overwrite the previous-use
  // timestamp; internally guarded so Strict Mode renders are harmless.
  captureAnalysisLaunchInactivity();
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
  const handledNotificationResponses = useRef(new Set<string>());

  // Force-update (hard update) gate. Checked in the background on mount,
  // INDEPENDENT of the prewarm gate above -- checkForceUpdate() fails open on
  // every error and we never let it block splash hide / app render. When it
  // resolves required=true (installed version < server min_version, platform
  // matches), we overlay an unescapable full-screen update screen.
  const [forceUpdate, setForceUpdate] = useState<{ message: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void checkForceUpdate().then((res) => {
      if (active && res.required) setForceUpdate({ message: res.message });
    });
    return () => {
      active = false;
    };
  }, []);

  // Stage 6 follow-up (commit 31 + commit 33): load Inter font
  // family at startup using expo-font's imperative Font.loadAsync,
  // NOT @expo-google-fonts's useFonts hook.
  //
  // Why not useFonts: pnpm pulled in a duplicate React 18.3.1 copy
  // for @expo-google-fonts/inter@0.4.2 (whose package.json declares
  // no react peerDependency), and React refuses to share fiber state
  // across two React copies. The result was a hard crash on every
  // app launch ("Invalid hook call: useState of null") because
  // useFonts's internal useState was being called against the wrong
  // React instance. Font.loadAsync is a pure function not bound to
  // any React internals, so it sidesteps the dual-React issue.
  //
  // The codebase has 100+ usages of fontFamily: 'Inter_*' across all
  // screens. Before this load, iOS silently fell back to SF Pro for
  // every reference -- explaining why the AI insight UI looked
  // "thinner than the design intends" even with Inter_900Black
  // declared. After this load, every existing fontFamily declaration
  // renders the real Inter glyphs.
  const [fontsLoaded, setFontsLoaded] = useState(false);
  useEffect(() => {
    Font.loadAsync({
      Inter_400Regular,
      Inter_500Medium,
      Inter_600SemiBold,
      Inter_700Bold,
      Inter_800ExtraBold,
      Inter_900Black,
    })
      .then(() => setFontsLoaded(true))
      .catch((err) => {
        // Graceful degradation: if font load fails (offline, asset
        // corrupted, etc), unblock the app so users still get a
        // working UI with iOS system-font fallback. The dev console
        // captures the error for triage.
        console.warn('[_layout] Font.loadAsync failed:', err);
        setFontsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!isReady || !fontsLoaded) return;
    let active = true;
    const openNotification = (response: Notifications.NotificationResponse | null) => {
      if (!active || !response) return;
      const data = response.notification.request.content.data as { type?: unknown } | null;
      if (data?.type !== 'partner_reflect') return;
      const responseId = response.notification.request.identifier;
      if (handledNotificationResponses.current.has(responseId)) return;
      handledNotificationResponses.current.add(responseId);
      // Cover the destination before invalidating its cached feed. Home now
      // releases this gate only after the forced partner-feed/bubble read and
      // its final native visual layout are both ready.
      beginHomeEntry({ target: 'home', forceHomeData: true });
      emitHomeRefresh();
      // Let expo-router finish mounting its root navigator on a cold launch,
      // then select Home. The pending refresh pulse survives if Home has not
      // mounted yet and forces a network read as soon as it does.
      setTimeout(() => {
        if (active) router.navigate('/(main)/(tabs)' as never);
      }, 0);
      Notifications.clearLastNotificationResponse();
    };

    openNotification(Notifications.getLastNotificationResponse());
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    return () => {
      active = false;
      responseSubscription.remove();
    };
  }, [fontsLoaded, isReady]);

  useEffect(() => {
    if (!isReady || !fontsLoaded) return;
    let lastHandledAt = 0;
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (!isWidgetFriendsUrl(url)) return;
      const now = Date.now();
      if (now - lastHandledAt < 750) return;
      lastHandledAt = now;
      // Native widgets point to Paired. Keep its cached page mounted under the
      // cover while pairing + reflection feed are force-revalidated.
      beginHomeEntry({ target: 'friends', forceHomeData: true });
      router.navigate('/(main)/(tabs)/friends' as never);
    });
    return () => subscription.remove();
  }, [fontsLoaded, isReady]);

  // Cold start restores the local session, then renders immediately. Remote
  // caches refresh in the background under their own lazy TTLs, so a slow
  // network can never hold the native splash screen open.
  useEffect(() => {
    let cancelled = false;

    // These are bundled files, so this performs no network request. Start
    // their native WebP decode immediately but never delay the launch gate.
    void warmEntryBackgrounds();

    const finish = () => {
      if (!cancelled) {
        setIsReady(true);
      }
    };

    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        console.warn('[layout] cold-start prewarm timeout, hiding splash anyway');
      }
      finish();
    }, PREWARM_TIMEOUT_MS);

    void (async () => {
      try {
        // Tiny R2 pointer only. Never awaited: content refresh/download is
        // staged behind the native splash and can continue after Home paints.
        void checkContentVersionInBackground();
        const initialUrl = await Linking.getInitialURL().catch(() => null);
        const initialNotification = Notifications.getLastNotificationResponse();
        const initialNotificationData = initialNotification?.notification.request.content.data as { type?: unknown } | null;
        if (initialNotificationData?.type === 'partner_reflect') {
          beginHomeEntry({ target: 'home', forceHomeData: true });
        } else if (isWidgetFriendsUrl(initialUrl)) {
          beginHomeEntry({ target: 'friends', forceHomeData: true });
        }
        const session = await getCurrentSession();
        const userId = session?.user?.id;
        void fetchAppConfig();
        if (userId) {
          // Opportunistically cache the announcement image while startup work
          // is already happening. This is also deliberately non-blocking.
          void prepareUnreadAnnouncement(userId);
          void fetchSubscriptionTier(userId).catch(() => {});
          void fetchMeStats(userId).catch(() => {});
        }
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
  // Splash is no longer hidden here on prewarm completion. Industry-
  // standard pattern: the native splash stays up until the first real
  // destination screen has actually painted its initial content, then
  // calls hideSplashOnce() — guaranteeing no blank/placeholder frame
  // between splash and content. Each destination hides it from its own
  // "content is painted" signal, not on mere layout:
  //   - home:       the character VideoView's onFirstFrameRender (the
  //                 first frame is painted, so no black gap on hand-off).
  //   - onboarding: the page <Image>'s onLoad.
  //   - auth:       its root onLayout.
  //
  // This effect is only a defensive fallback: if no destination screen
  // ever signals (unexpected error, navigation edge case, or a signal
  // that never fires), force the splash to hide after 10s so the user is
  // never stuck on it.
  useEffect(() => {
    const fallback = setTimeout(() => {
      hideSplashOnce();
    }, 10000);
    return () => clearTimeout(fallback);
  }, []);

  useEffect(() => {
    // ---- AppState: control auto-refresh based on foreground/background ----
    const handleAppStateChange = (state: AppStateStatus) => {
      observeHomeEntryAppState(state);
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        // R2 assets are warmed only while the app is in use. The queue
        // rebuilds from the manifest + local disk on every cold launch, so a
        // force-close naturally resumes only the still-missing files.
        resumeDownloadQueue();
        void touchActivity();
        void reconcileDailyReminderSchedule();
        void syncRemoteNotificationRegistration();
        void checkContentVersionInBackground();
        void resumeSubscriptionRealtime().catch((error) => {
          console.warn('[layout] entitlement realtime resume failed:', error);
        });
        // Google Play can complete a pending purchase while the app is in the
        // background. Re-query on every foreground entry so entitlement and
        // acknowledgement recover without another Subscribe tap.
        void reconcileAvailablePurchases();
        void resumePairingRealtime().catch((error) => {
          console.warn('[layout] pairing realtime resume failed:', error);
        });
      } else {
        supabase.auth.stopAutoRefresh();
        pauseDownloadQueue();
        void stopSubscriptionRealtime().catch((error) => {
          console.warn('[layout] entitlement realtime stop failed:', error);
        });
        void stopPairingRealtime().catch((error) => {
          console.warn('[layout] pairing realtime stop failed:', error);
        });
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
      if (event === 'INITIAL_SESSION') {
        observeSessionIdentity(session?.user?.id ?? null);
        if (session?.user?.id) setTimeout(() => {
          void reconcileAvailablePurchases();
          void syncRemoteNotificationRegistration();
        }, 0);
        return;
      }
      if (event === 'SIGNED_IN') {
        const sameIdentity = observeSessionIdentity(session?.user?.id ?? null);
        if (session?.user?.id) setTimeout(() => {
          void reconcileAvailablePurchases();
          void syncRemoteNotificationRegistration({ force: true });
        }, 0);
        if (sameIdentity) return;
        const isAnonymous =
          (session?.user as { is_anonymous?: boolean } | undefined)?.is_anonymous ?? false;

        // The onboarding paywall prepares its anonymous UUID before opening
        // StoreKit / Play Billing. That auth event is identity preparation,
        // not onboarding completion: keep the current screen mounted so the
        // user can finish the store sheet and the remaining onboarding steps.
        // A deliberate sign-in to an existing Apple/Google/email account is
        // non-anonymous and still follows the normal signing-in route below.
        if (isAnonymous && !hasSeenIntro()) {
          if (session?.user?.id) {
            void startSubscriptionRealtime(session.user.id).catch((error) => {
              console.warn('[layout] onboarding entitlement realtime start failed:', error);
            });
            void startPairingRealtime(session.user.id).catch((error) => {
              console.warn('[layout] onboarding pairing realtime start failed:', error);
            });
          }
          return;
        }

        // Only a DIFFERENT identity reaches this point. Supabase also emits
        // SIGNED_IN when recovering the same session; that must not clear
        // caches or replace a page the user is currently interacting with.
        // Switching to an existing Apple/Google/email account still scrubs
        // the outgoing owner's caches even without a preceding SIGNED_OUT.
        //
        // Every 'user'-scoped key goes, not the four this handler happened to
        // name. Which keys those are is decided in shared/storage/keys.ts, once,
        // rather than remembered here every time someone adds a cache.
        //
        // 'preauth' is deliberately spared. novame_onboarding_state holds
        // answers the *arriving* user typed minutes ago, and
        // syncOnboardingIfPending() below reads MMKV on its first synchronous
        // line -- clear it here and pendingSync reads false, the sync never
        // runs, and their aspire words never reach the server. The old comment
        // that used to sit here got the conclusion right for the wrong reason.
        //
        // novame.shipping is NOT spared, despite what that comment claimed. It
        // is the previous user's home address, and it renders straight into
        // the next user's shipping form.
        try {
          clearOnSignIn();
        } catch (e) {
          console.warn('[layout] sign-in cache clear failed:', e);
        }
        // Dev-only. Only registered preauth/device keys should survive here;
        // anything user-scoped is a key that outlived its owner.
        debugAccountKeysRemaining('SIGNED_IN');
        if (session?.user?.id) {
          void startSubscriptionRealtime(session.user.id).catch((error) => {
            console.warn('[layout] entitlement realtime start failed:', error);
          });
          void startPairingRealtime(session.user.id).catch((error) => {
            console.warn('[layout] pairing realtime start failed:', error);
          });
        }

        // Fire-and-forget onboarding sync if there is pending mmkv data
        // from a fresh onboarding completion. Errors are logged and
        // swallowed inside syncOnboardingIfPending so navigation never
        // blocks. Stage 3.5 (B40) deferred this from 3.4 step 5.
        // Stage 5.WR.2 (Bug 2 fix): route through signing-in screen
        // so it can prewarm character-state / subscription / me-stats
        // before home renders. Avoids the "Loading..." speech bubble
        // and missing Me page header on first frame after sign-in.
        router.replace('/(auth)/signing-in');
      } else if (event === 'SIGNED_OUT') {
        observeSessionIdentity(null);
        void stopSubscriptionRealtime().catch((error) => {
          console.warn('[layout] entitlement realtime sign-out failed:', error);
        });
        void stopPairingRealtime().catch((error) => {
          console.warn('[layout] pairing realtime sign-out failed:', error);
        });
        // Stage 5.IAP.5 (Bug #5): clear all per-user MMKV caches so
        // the next user (or fresh sign-in) does not see stale data
        // from the previous user. Per Supabase official guidance for
        // SIGNED_OUT: 'Use this to clean up any local storage your
        // application has associated with the user.'
        try {
          // 'user' + 'preauth'. The onboarding draft belonged to the account
          // that is leaving, and every cache derived from an authenticated
          // request goes with it -- including the pointer to an unpublished
          // voice recording, whose .m4a is deleted by that key's onClear hook.
          //
          // novame_app_config is no longer cleared. It is 'device' scoped:
          // pricing and unlock thresholds are properties of the app, not of
          // the account. The old handler cleared it "defensively", which bought
          // nothing and cost a refetch on every sign-out.
          clearOnSignOut();
          // An in-memory queue, not MMKV. The registry cannot see it, so it
          // still has to be drained by hand: leftover unlock modals from the
          // prior session would otherwise flash on the next sign-in.
          clearSkinUnlockQueue();
        } catch (e) {
          console.warn('[layout] sign-out cache clear failed:', e);
        }
        // Dev-only. Should print zero survivors. Whatever it does print is
        // what the next user to sign in on this phone would have read.
        debugAccountKeysRemaining('SIGNED_OUT');
        router.replace('/(auth)/sign-in');
      }
      // TOKEN_REFRESHED / USER_UPDATED do not navigate or clear caches.
    });

    return () => {
      appStateSub.remove();
      authSub.unsubscribe();
      void stopSubscriptionRealtime().catch((error) => {
        console.warn('[layout] entitlement realtime cleanup failed:', error);
      });
      void stopPairingRealtime().catch((error) => {
        console.warn('[layout] pairing realtime cleanup failed:', error);
      });
      void cleanupIAP();
    };
  }, []);

  // While prewarm runs, return null so React doesn't render the
  // app tree. The native splash (kept visible by preventAutoHideAsync)
  // remains on screen. Per expo-splash-screen official example, this
  // is the canonical pattern.
  // Do not paint destination screens with a system-font fallback and then
  // swap to Inter after the first interaction. Besides visible typography
  // flicker, that changed the Onboarding hero from regular to bold only after
  // tapping Start. Both gates are local and fail open, so this cannot turn a
  // network delay into a blocked launch.
  if (!isReady || !fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AdaptiveAppFrame>
        <BottomSheetModalProvider>
          <SafeAreaProvider>
            <ThemeProvider>
              <ErrorBoundary>
                <MetaPrivacyProvider>
                  <Stack
                    screenOptions={{
                      // Global default = the app's deep brown. The native
                      // splash->JS handoff gap on first launch (and the index.tsx
                      // redirect window) shows this navigator content background;
                      // brown keeps it seamless with the Home/Quests ground
                      // (2026-07-30 — was black, read as a purple flash).
                      headerShown: false,
                      contentStyle: { backgroundColor: '#4C331B' },
                      animation: 'none',
                    }}
                  />
                  {forceUpdate ? <ForceUpdateGate message={forceUpdate.message} /> : null}
                  <StatusBar style="dark" />
                  <GoodVibesInboxGate />
                  <AppDialogHost />
                </MetaPrivacyProvider>
              </ErrorBoundary>
            </ThemeProvider>
          </SafeAreaProvider>
        </BottomSheetModalProvider>
      </AdaptiveAppFrame>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
