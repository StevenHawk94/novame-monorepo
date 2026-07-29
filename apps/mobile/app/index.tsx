import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Redirect } from 'expo-router';

import { AssetGateError } from '@/components/main/asset-gate-error';
import { ensureSession, getCurrentSession } from '@/lib/auth';
import { hasSeenIntro } from '@/lib/onboarding';
import { ensureP0Ready } from '@/lib/download-queue';
import { ICONS } from '@/lib/icons';

/**
 * Entry gate. Blocks on P0 assets, then routes.
 *
 * GUEST MODE (2026-07-26): the app never forces a login. A signed-in (or
 * anonymous) session goes home; a fresh install goes to onboarding, which
 * ends by creating an ANONYMOUS session; a returning session-less launch
 * silently re-establishes an anonymous session and goes home. The classic
 * sign-in screen only appears when anonymous auth is unavailable, or via
 * "Already have an account? Log in".
 *
 * While the gate resolves it shows the splash design (bunny on the beige
 * grid) instead of a blank frame.
 */
type Gate = 'loading' | 'ready' | 'failed';
type Route = 'main' | 'onboarding' | 'bootstrap' | 'signin';

export default function Index() {
  const [gate, setGate] = useState<Gate>('loading');
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await getCurrentSession();
      if (cancelled) return;
      if (session) {
        setRoute('main');
      } else if (!hasSeenIntro()) {
        setRoute('onboarding');
      } else {
        // Returning guest without a session: quietly mint an anonymous one.
        const ok = await ensureSession();
        if (cancelled) return;
        setRoute(ok ? 'bootstrap' : 'signin');
      }
      try {
        await ensureP0Ready();
        if (!cancelled) setGate('ready');
      } catch {
        if (!cancelled) setGate('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate === 'failed') return <AssetGateError onRetry={() => setGate('loading')} />;
  if (gate === 'loading' || route === null) {
    return (
      <View style={[styles.splash, { backgroundColor: '#F8E2C1' }]}>
        <ExpoImage source={ICONS.obGridBg} style={StyleSheet.absoluteFill} contentFit="cover" />
        <ExpoImage source={ICONS.obBunnyHead} style={styles.splashBunny} contentFit="contain" />
      </View>
    );
  }
  if (route === 'main') return <Redirect href="/(main)/(tabs)" />;
  if (route === 'onboarding') return <Redirect href="/(onboarding)" />;
  if (route === 'bootstrap') return <Redirect href="/(auth)/signing-in" />;
  return <Redirect href="/(auth)/sign-in" />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  splashBunny: { width: 132, height: 158 },
});
