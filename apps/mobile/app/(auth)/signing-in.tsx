import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { router } from 'expo-router';

import { getCurrentSession } from '@/lib/auth';
import {
  fetchSubscriptionTier,
  getCachedSubscription,
  setCachedSubscription,
} from '@/lib/subscription';
import { fetchMeStats } from '@/lib/me-stats';
import { syncOnboardingCompanion } from '@/lib/onboarding';
import { ensureP0Ready } from '@/lib/download-queue';
import { AssetGateError } from '@/components/main/asset-gate-error';
import { ICONS } from '@/lib/icons';

/**
 * P0 asset gate on the login path.
 *
 * Signing in is an in-app navigation that never re-runs app/index.tsx, so
 * without a gate here the user lands on Home before its assets are local.
 *
 * What changed
 * ------------
 * v1 awaited fetchCharacterState() first, purely so it could compute WHICH
 * video to gate: the clip depends on the user's willpower and mode, and the
 * SIGNED_IN handler had just cleared that cache. character-state is gone, and
 * so is the argument -- ensureP0Ready() still downloads every bucket-root
 * asset, it just no longer receives a hint about one extra file.
 *
 * This is harmless today (Phase A's Home is a placeholder with no video) and
 * NOT harmless in Phase C. When the companion returns, the first-frame video
 * depends on its sleep/fly state, and this gate has to be rebuilt around it.
 *
 * Also gone: the tab warm. It prefetched Growth, Discover and Assets, three
 * tabs that no longer exist.
 *
 * The gateFailed latch stays, and it is subtle enough to be worth stating: a
 * P0 download that completes AFTER the retry screen has appeared must not
 * silently navigate the user into Home. Only an explicit Retry, which re-runs
 * this effect, may do that.
 */


const MIN_DISPLAY_MS = 600;

/**
 * How long we WAIT before offering Retry -- not a hard stop. The download queue
 * never stops retrying in the background, and P0 is well under 1MB.
 */
const P0_ASSET_TIMEOUT_MS = 30000;

export default function SigningInScreen() {
  const [gateState, setGateState] = useState<'pending' | 'failed'>('pending');
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const start = Date.now();
    let cancelled = false;
    let navigated = false;
    let gateFailed = false;

    const goHome = () => {
      if (navigated || cancelled || gateFailed) return;
      navigated = true;
      const elapsed = Date.now() - start;
      setTimeout(() => {
        if (!cancelled) router.replace('/(main)/(tabs)');
      }, Math.max(0, MIN_DISPLAY_MS - elapsed));
    };

    const timer = setTimeout(() => {
      if (!cancelled && !navigated) {
        gateFailed = true;
        setGateState('failed');
      }
    }, P0_ASSET_TIMEOUT_MS);

    void (async () => {
      const session = await getCurrentSession();
      const userId = session?.user?.id;
      if (!userId) {
        navigated = true;
        clearTimeout(timer);
        router.replace('/(auth)/sign-in');
        return;
      }

      if (!getCachedSubscription()) {
        setCachedSubscription({ tier: 'free', lastFetchedAtMs: Date.now() });
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

      await ensureP0Ready();
      if (cancelled) return;

      clearTimeout(timer);
      goHome();
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [retryNonce]);

  if (gateState === 'failed') {
    return <AssetGateError onRetry={() => setRetryNonce((n) => n + 1)} />;
  }

  return (
    <View style={styles.root}>
      <ExpoImage source={ICONS.obGridBg} style={StyleSheet.absoluteFill} contentFit="cover" />
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
