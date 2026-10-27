import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { ensureSession, getCurrentSession } from '@/lib/auth';
import {
  fetchSubscriptionTier,
} from '@/lib/subscription';
import { fetchMeStats } from '@/lib/me-stats';
import { syncOnboardingCompanion, syncOnboardingProfile } from '@/lib/onboarding';
import { BurrowLaunchScreen } from '@/components/main/burrow-launch-screen';
import { beginHomeEntry, deferHomeEntryNotification, homeEntryRemainingMs } from '@/lib/home-entry-readiness';

/** Bounded auth bootstrap. Remote assets always warm in the background. */
const MIN_DISPLAY_MS = 0;
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
    beginHomeEntry({ target: 'home', forceHomeData: true });
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

    const deadline = setTimeout(goHome, homeEntryRemainingMs());
    void (async () => {
      const restored = await withTimeout(getCurrentSession(), SESSION_RESTORE_TIMEOUT_MS);
      if (cancelled || navigated) return;
      let userId = restored.status === 'resolved' ? restored.value?.user?.id : null;

      // A returning guest can lose the persisted anonymous session after an
      // Android storage hiccup or OS cleanup. Re-establish it here, but keep
      // the network attempt bounded so offline launch can never sit on the
      // splash indefinitely.
      if (!userId && restored.status === 'resolved') {
        const ensured = await withTimeout(ensureSession(), ANONYMOUS_SESSION_TIMEOUT_MS);
        if (cancelled || navigated) return;
        if (ensured.status === 'resolved' && ensured.value) {
          const retry = await withTimeout(getCurrentSession(), SESSION_RESTORE_TIMEOUT_MS);
          if (cancelled || navigated) return;
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
      void syncOnboardingProfile(userId).catch(()=>{});

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
    })().catch(() => { goHome(); });

    return () => {
      cancelled = true;
      clearTimeout(deadline);
    };
  }, [params.after]);

  return <BurrowLaunchScreen />;
}
