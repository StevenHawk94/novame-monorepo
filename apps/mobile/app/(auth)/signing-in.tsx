import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';

import { ensureSession, getCurrentSession } from '@/lib/auth';
import {
  fetchSubscriptionTier,
} from '@/lib/subscription';
import { fetchMeStats } from '@/lib/me-stats';
import { syncOnboardingCompanion } from '@/lib/onboarding';
import { ICONS } from '@/lib/icons';
import { GridBackground } from '@/components/ui/grid-background';
import { deferHomeEntryNotification, getHomeEntryState } from '@/lib/home-entry-readiness';

/** Bounded auth bootstrap. Remote assets always warm in the background. */
const MIN_DISPLAY_MS = 600;
const SESSION_RESTORE_TIMEOUT_MS = 2000;
const ANONYMOUS_SESSION_TIMEOUT_MS = 5000;

type TimedResult<T> = { status: 'resolved'; value: T } | { status: 'timeout' };

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<TimedResult<T>> {
  return Promise.race([
    promise.then((value) => ({ status: 'resolved' as const, value })),
    new Promise<TimedResult<T>>((resolve) => {
      setTimeout(() => resolve({ status: 'timeout' }), ms);
    }),
  ]);
}

export default function SigningInScreen() {
  const params = useLocalSearchParams<{ after?: string }>();

  useEffect(() => {
    const start = Date.now();
    let cancelled = false;
    let navigated = false;

    const goHome = () => {
      if (navigated || cancelled) return;
      navigated = true;
      const elapsed = Date.now() - start;
      setTimeout(() => {
        if (!cancelled) {
          const preparingFirstHome = getHomeEntryState().pending;
          if (preparingFirstHome && params.after === 'notification-settings') {
            deferHomeEntryNotification();
          }
          router.replace(
            params.after === 'notification-settings' && !preparingFirstHome
              ? '/(main)/(modals)/notification-settings'
              : '/(main)/(tabs)',
          );
        }
      }, Math.max(0, MIN_DISPLAY_MS - elapsed));
    };

    void (async () => {
      const restored = await withTimeout(getCurrentSession(), SESSION_RESTORE_TIMEOUT_MS);
      let userId = restored.status === 'resolved' ? restored.value?.user?.id : null;

      // A returning guest can lose the persisted anonymous session after an
      // Android storage hiccup or OS cleanup. Re-establish it here, but keep
      // the network attempt bounded so offline launch can never sit on the
      // splash indefinitely.
      if (!userId && restored.status === 'resolved') {
        const ensured = await withTimeout(ensureSession(), ANONYMOUS_SESSION_TIMEOUT_MS);
        if (ensured.status === 'resolved' && ensured.value) {
          const retry = await withTimeout(getCurrentSession(), SESSION_RESTORE_TIMEOUT_MS);
          userId = retry.status === 'resolved' ? retry.value?.user?.id : null;
        }
      }

      // A timed-out session read usually means Supabase still owns its Android
      // storage lock. Render Home from local caches instead of trapping the
      // user; auth initialization can finish in the background.
      if (restored.status === 'timeout') {
        goHome();
        return;
      }

      if (!userId) {
        navigated = true;
        router.replace('/(auth)/sign-in');
        return;
      }

      // Onboarding: sync the locally-chosen companion into a companions row on
      // first sign-in (there was no user_id when the pet was picked). Idempotent
      // and fire-and-forget -- a failure retries next launch, and Reflect fails
      // loud if the companion is still missing.
      void syncOnboardingCompanion(userId);

      void fetchSubscriptionTier(userId).catch((e) => {
        console.warn('[signing-in] subscription fetch failed:', (e as Error)?.message || e);
      });
      void fetchMeStats(userId).catch((e) => {
        console.warn('[signing-in] me-stats fetch failed:', (e as Error)?.message || e);
      });

      // Remote assets remain background work. On first onboarding completion,
      // HomeEntryGate keeps this loading look until bundled visuals display in
      // the actual Home views; returning launches remain cache-first.
      goHome();
    })();

    return () => {
      cancelled = true;
    };
  }, [params.after]);

  return (
    <View style={styles.root}>
      <GridBackground />
      <ExpoImage source={ICONS.obBunnyHead} style={styles.bunny} contentFit="contain" />
      <ActivityIndicator size="small" color="#8A6240" style={styles.spinner} />
    </View>
  );
}

// Same look as the entry-gate splash (grid ground + bunny head) so the
// onboarding→home handoff never flashes a different scene.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8E2C1', alignItems: 'center', justifyContent: 'center' },
  bunny: { width: 132, height: 158, marginBottom: 24 },
  spinner: { marginTop: 4 },
});
