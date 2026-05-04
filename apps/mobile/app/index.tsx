import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';

import { getCurrentSession } from '@/lib/auth';
import { isOnboardingDone } from '@/lib/onboarding';

/**
 * Startup route — decides where to send the user after launch.
 *
 * Three-way gate (Q-3.4-redirect = A + Q-3.5-B34 trigger restored):
 *
 *   onboarding not done                 → /(onboarding)
 *   onboarding done + no session        → /(auth)/sign-in
 *   onboarding done + session exists    → /(main)/(tabs)
 *
 * The onboarding flag lives in MMKV under "novame_onboarding_state".done
 * (managed by src/lib/onboarding.ts), mirroring the old Capacitor
 * localStorage logic but as a structured JSON blob.
 *
 * ----
 * Why useEffect for session but synchronous read for onboarding:
 *
 * isOnboardingDone() reads from MMKV which is fully synchronous,
 * so we can decide the onboarding redirect on the first render.
 *
 * getCurrentSession() reads from AsyncStorage which is async on RN,
 * so we render an ActivityIndicator until the read finishes, then
 * swap to the appropriate <Redirect>.
 *
 * Performance benefit of the split: users who haven't completed
 * onboarding bypass the AsyncStorage read entirely and jump
 * straight to (onboarding) with zero startup latency.
 *
 * After this initial dispatch, app/_layout.tsx's onAuthStateChange
 * listener takes over for any subsequent sign-in / sign-out events.
 */
export default function Index() {
  // Synchronous MMKV read — safe to call during render.
  const onboardingDone = isOnboardingDone();

  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    // Skip the session read entirely if we're going to redirect to
    // (onboarding) anyway — saves an unnecessary AsyncStorage hit.
    if (!onboardingDone) return;

    let cancelled = false;
    (async () => {
      const session = await getCurrentSession();
      if (!cancelled) {
        setHasSession(session !== null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onboardingDone]);

  // Branch 1: onboarding not done — go to onboarding flow immediately.
  if (!onboardingDone) {
    return <Redirect href="/(onboarding)" />;
  }

  // Branch 2: onboarding done, session check still pending — show loading.
  if (hasSession === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0F0B2E',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color="#C084FC" />
      </View>
    );
  }

  // Branch 3: onboarding done, session resolved — go to main or sign-in.
  return hasSession ? (
    <Redirect href="/(main)/(tabs)" />
  ) : (
    <Redirect href="/(auth)/sign-in" />
  );
}
