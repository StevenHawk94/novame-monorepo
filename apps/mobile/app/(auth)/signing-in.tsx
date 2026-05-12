/**
 * Signing-in loading screen (Stage 5.WR.2, Bug 2).
 *
 * Sits between sign-in success and the home tab to prewarm critical
 * data so the home tab renders fully populated on first frame.
 *
 * Before this screen, the user signed in → router.replace to
 * /(main)/(tabs)/ immediately → home tab mounted → showed speech
 * bubble "Loading..." for 1-3 seconds while character-state fetched
 * → Me page header showed "--" until separate me-stats fetch
 * returned. UX felt broken on slower networks.
 *
 * Now: sign-in success → router.replace to here → this screen
 * runs three fetches in parallel:
 *   - fetchCharacterState (wp, level, exp, mode, outfit, ...)
 *   - fetchSubscriptionTier (free/basic/pro/ultra)
 *   - fetchMeStats (totalWords, totalCards, peopleImpacted, totalExp)
 *
 * Then router.replace to /(main)/(tabs)/. By the time home renders,
 * all three MMKV caches are hot — UI renders instantly with real data.
 *
 * Two safeguards:
 *   - Promise.allSettled (not Promise.all): a failed fetch doesn't
 *     block navigation. The home tab degrades gracefully to its
 *     cached / default state for any data that didn't return.
 *   - 3-second timeout: if all three fetches hang (network down),
 *     force the redirect anyway. The user shouldn't be trapped here.
 *   - 600ms minimum display: prevents a sub-300ms fetch from
 *     producing a one-frame flash that looks like a glitch.
 *
 * Visual: purple background, centered logo, spinner below. Matches
 * Me page's purple top section (#7C3AED) for visual continuity.
 */

import { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { getCurrentSession } from '@/lib/auth';
import { fetchCharacterState } from '@/lib/character-state';
import { fetchSubscriptionTier } from '@/lib/subscription';
import { fetchMeStats } from '@/lib/me-stats';

const LOGO = require('../../assets/images/logo.png');

const PREWARM_TIMEOUT_MS = 3000;
const MIN_DISPLAY_MS = 600;

export default function SigningInScreen() {
  useEffect(() => {
    let navigated = false;
    const start = Date.now();

    const goHome = () => {
      if (navigated) return;
      navigated = true;
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => {
        router.replace('/(main)/(tabs)');
      }, remaining);
    };

    // Timeout safety net — never trap the user here.
    const timeoutId = setTimeout(() => {
      console.warn('[signing-in] prewarm timeout, navigating anyway');
      goHome();
    }, PREWARM_TIMEOUT_MS);

    void (async () => {
      const session = await getCurrentSession();
      const userId = session?.user?.id;
      if (!userId) {
        // No session somehow — bounce back to sign-in. Should be
        // unreachable in practice (this screen is only entered on
        // sign-in success), but defensive.
        clearTimeout(timeoutId);
        navigated = true;
        router.replace('/(auth)/sign-in');
        return;
      }

      // Parallel prewarm. allSettled so a single failure doesn't
      // block navigation.
      await Promise.allSettled([
        fetchCharacterState(userId),
        fetchSubscriptionTier(userId),
        fetchMeStats(userId),
      ]);

      clearTimeout(timeoutId);
      goHome();
    })();

    return () => {
      clearTimeout(timeoutId);
    };
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
