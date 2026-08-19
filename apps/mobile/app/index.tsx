import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Redirect } from 'expo-router';

import { getCurrentSession } from '@/lib/auth';
import { hasSeenIntro } from '@/lib/onboarding';
import { prefetchOutfitAssets } from '@/lib/outfits';
import { hideSplashOnce } from '@/lib/splash';

/**
 * Entry router. Remote assets warm in the background and never block launch;
 * every first screen has a bundled fallback for its initial paint.
 *
 * GUEST MODE (2026-07-26): the app never forces a login. A signed-in (or
 * anonymous) session goes home; a fresh install goes to onboarding, which
 * ends by creating an ANONYMOUS session; a returning session-less launch
 * silently re-establishes an anonymous session and goes home. The classic
 * sign-in screen only appears when anonymous auth is unavailable, or via
 * "Already have an account? Log in".
 *
 * While the local route resolves, iOS shows the bundled full-screen splash.
 * Android keeps its native solid-colour + centred-icon splash visible until
 * the destination paints, avoiding a second full-screen splash transition.
 * No remote asset download is awaited here.
 */
type Route = 'main' | 'onboarding' | 'bootstrap' | 'signin';

// Supabase normally restores the persisted session from AsyncStorage almost
// instantly. On a few Android process restarts the auth storage lock can take
// an unbounded amount of time, though. Never let that keep the JS splash on
// screen forever: the bootstrap route can finish/retry auth independently.
const SESSION_RESTORE_TIMEOUT_MS = 2000;

async function getLaunchSession() {
  return Promise.race([
    getCurrentSession(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_RESTORE_TIMEOUT_MS)),
  ]);
}

export default function Index() {
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Warm the Bunny Closet (images then videos, free before Plus) in the
    // background from the very first launch — including the onboarding path.
    prefetchOutfitAssets();
    void (async () => {
      const session = await getLaunchSession();
      if (cancelled) return;
      if (session) {
        setRoute('main');
      } else if (!hasSeenIntro()) {
        setRoute('onboarding');
      } else {
        // Never perform a network auth mutation while the full-screen entry
        // splash is mounted. Bootstrap owns the bounded anonymous-session
        // recovery and always releases its UI within a few seconds.
        setRoute('bootstrap');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (route === null) {
    if (Platform.OS === 'android') {
      // Do not hide the Android native splash here. The destination screen
      // owns the hand-off via hideSplashOnce() after its first real frame.
      return <View style={styles.splash} />;
    }

    return (
      <View style={styles.splash}>
        <ExpoImage
          source={require('../assets/splash-full.png')}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          onLoad={hideSplashOnce}
        />
      </View>
    );
  }
  if (route === 'main') return <Redirect href="/(main)/(tabs)" />;
  if (route === 'onboarding') return <Redirect href="/(onboarding)" />;
  if (route === 'bootstrap') return <Redirect href="/(auth)/signing-in" />;
  return <Redirect href="/(auth)/sign-in" />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#F8E2C1' },
});
