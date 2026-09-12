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
import { beginHomeEntry, deferHomeEntryNotification } from '@/lib/home-entry-readiness';

/** Bounded auth bootstrap. Remote assets always warm in the background. */
const MIN_DISPLAY_MS = 600;
const SESSION_RESTORE_TIMEOUT_MS = 2000;
const ANONYMOUS_SESSION_TIMEOUT_MS = 5000;
const COMPANION_SYNC_TIMEOUT_MS = 5000;

type TimedResult<T> = { status: 'resolved'; value: T } | { status: 'timeout' };

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<TimedResult<T>> {
  return new Promise<TimedResult<T>>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      resolve({ status: 'timeout' });
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'resolved', value });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
          beginHomeEntry({ target: 'home', forceHomeData: true });
          if (params.after === 'notification-settings') {
            deferHomeEntryNotification();
          }
          router.replace('/(main)/(tabs)');
        }
      }, Math.max(0, MIN_DISPLAY_MS - elapsed));
    };

    void (async () => {
      const restored = await withTimeout(getCurrentSession(), SESSION_RESTORE_TIMEOUT_MS);
      if (cancelled) return;
      let userId = restored.status === 'resolved' ? restored.value?.user?.id : null;

      // A returning guest can lose the persisted anonymous session after an
      // Android storage hiccup or OS cleanup. Re-establish it here, but keep
      // the network attempt bounded so offline launch can never sit on the
      // splash indefinitely.
      if (!userId && restored.status === 'resolved') {
        const ensured = await withTimeout(ensureSession(), ANONYMOUS_SESSION_TIMEOUT_MS);
        if (cancelled) return;
        if (ensured.status === 'resolved' && ensured.value) {
          const retry = await withTimeout(getCurrentSession(), SESSION_RESTORE_TIMEOUT_MS);
          if (cancelled) return;
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

      // Start the durable onboarding completion before revealing Home. It is
      // an economy prerequisite for Reflect/Quests/Kits, but the visual entry
      // gate stays bounded while the idempotent request continues underneath.
      const companionSync = withTimeout(
        syncOnboardingCompanion(userId, { force: true }),
        COMPANION_SYNC_TIMEOUT_MS,
      );

      void fetchSubscriptionTier(userId).catch((e) => {
        console.warn('[signing-in] subscription fetch failed:', (e as Error)?.message || e);
      });
      void fetchMeStats(userId).catch((e) => {
        console.warn('[signing-in] me-stats fetch failed:', (e as Error)?.message || e);
      });

      await companionSync;
      if (cancelled) return;
      // Five seconds is only the UI gate. The durable request keeps running
      // for up to 30 seconds and MainLayout resumes it on later foregrounds.
      // A real 30-second failure is logged by onboarding.ts, not here.

      // HomeEntryGate provides a short paint hand-off. Missing images or slow
      // refreshes never hold Home closed; its local/cached views repaint.
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
