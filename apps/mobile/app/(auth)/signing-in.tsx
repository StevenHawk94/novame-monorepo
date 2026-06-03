/**
 * Signing-in loading screen — P0 asset gate on the login path.
 *
 * Sits between sign-in success (_layout SIGNED_IN -> router.replace here)
 * and the home tab. This screen is the login-path equivalent of the
 * cold-start P0 gate in app/index.tsx: it holds the purple loading screen
 * until the assets the Home screen needs on its first frame are local,
 * then navigates to Home.
 *
 * Why gate here (not just cold start): logging in is an in-app navigation
 * that never re-runs app/index.tsx, so without a gate here the user lands
 * on Home before their current-state video is downloaded — showing a
 * failure placeholder. SIGNED_IN clears character-state cache, so we must
 * await fetchCharacterState() to learn the user's REAL state (wp / mode /
 * outfit) before computing which video to gate; otherwise we'd gate the
 * default 'hungry' clip and miss a returning user's study/chill clip.
 *
 * Flow:
 *   1. Seed default caches (so a new-user 404 on fetch still has values).
 *   2. await fetchCharacterState -> real wp/mode/outfit in cache.
 *   3. await ensureP0Ready(getHomeVideoFilename()) -> the real first-frame
 *      video is local (root P0 assets + that clip), gating the screen.
 *   4. subscription / me-stats fetch fire-and-forget (don't block video).
 *   5. Success -> navigate to Home (keeping MIN_DISPLAY_MS minimum).
 *   6. 15s timeout (poor network) -> AssetGateError with Retry, same as
 *      the cold-start gate. Connecting to <1MB of assets shouldn't take
 *      longer; if it does, the app is barely usable, so we hold here.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { getCurrentSession } from '@/lib/auth';
import {
  DEFAULT_NEW_USER_CHARACTER_STATE,
  fetchCharacterState,
  getCachedCharacterState,
  getHomeVideoFilename,
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
import { ensureP0Ready } from '@/lib/download-queue';
import { AssetGateError } from '@/components/main/asset-gate-error';

const LOGO = require('../../assets/images/logo.png');

const MIN_DISPLAY_MS = 600;
// Same budget as the cold-start gate in app/index.tsx. P0 + the first-frame
// video total well under 1MB; exceeding this means a very poor network.
const P0_ASSET_TIMEOUT_MS = 15000;

export default function SigningInScreen() {
  const [gateState, setGateState] = useState<'pending' | 'failed'>('pending');
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const start = Date.now();
    let cancelled = false;
    let navigated = false;

    const goHome = () => {
      if (navigated || cancelled) return;
      navigated = true;
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => {
        if (!cancelled) router.replace('/(main)/(tabs)');
      }, remaining);
    };

    // Overall timeout: if the gate hasn't completed within budget, show the
    // error screen (poor/no network). Retry re-runs the whole effect.
    const timer = setTimeout(() => {
      if (!cancelled && !navigated) setGateState('failed');
    }, P0_ASSET_TIMEOUT_MS);

    void (async () => {
      const session = await getCurrentSession();
      const userId = session?.user?.id;
      if (!userId) {
        // Defensive: should be unreachable (only entered on sign-in success).
        navigated = true;
        clearTimeout(timer);
        router.replace('/(auth)/sign-in');
        return;
      }

      // ---- 1. Seed default caches (fallback if fetch 404s for new users) ----
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
        setCachedSubscription({ tier: 'free', lastFetchedAtMs: Date.now() });
      }

      // ---- 2. await REAL character-state so we gate the right video ----
      // SIGNED_IN cleared this cache, so without awaiting we'd only have the
      // default (hungry). On failure (new-user trigger race -> 404) we keep
      // the seeded default, which resolves to the root 'hungry' clip.
      try {
        await fetchCharacterState(userId);
      } catch (e) {
        console.warn('[signing-in] character-state fetch failed:', (e as Error)?.message || e);
      }
      if (cancelled) return;

      // ---- 3. subscription / me-stats: background, don't block the video ----
      void fetchSubscriptionTier(userId).catch((e) => {
        console.warn('[signing-in] subscription fetch failed:', (e as Error)?.message || e);
      });
      void fetchMeStats(userId).catch((e) => {
        console.warn('[signing-in] me-stats fetch failed:', (e as Error)?.message || e);
      });

      // ---- 4. gate the first-frame video (real state now in cache) ----
      await ensureP0Ready(getHomeVideoFilename());
      if (cancelled) return;

      // ---- 5. ready -> Home ----
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
