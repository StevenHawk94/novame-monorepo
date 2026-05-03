import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';

import { getCurrentSession } from '@/lib/auth';

/**
 * Startup route — decides where to send the user after launch.
 *
 * Stage 3.4 scope (Q-3.4-redirect = A): only checks auth state.
 *
 *   session exists  → /(main)/(tabs)     (already signed in)
 *   no session      → /(auth)/sign-in    (needs to log in)
 *
 * Stage 3.5 (B34) will add the onboarding gate before the auth check:
 *
 *   onboarding not done                  → /(onboarding)
 *   onboarding done + no session         → /(auth)/sign-in
 *   onboarding done + session exists     → /(main)/(tabs)
 *
 * The onboarding flag will live in MMKV (key: "novame_onboarding_done"),
 * mirroring the old Capacitor localStorage logic.
 *
 * ----
 * Why useState/useEffect rather than just <Redirect>:
 *
 * getCurrentSession() reads from AsyncStorage, which is async on RN
 * (even when cached locally). We can't return the right <Redirect>
 * until the read finishes, so we render an ActivityIndicator on the
 * first frame, then swap to the appropriate <Redirect> once the
 * session check completes.
 *
 * The session check is read-once on mount. After this initial
 * dispatch, app/_layout.tsx's onAuthStateChange listener takes over
 * for any subsequent sign-in / sign-out events.
 */
export default function Index() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
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
  }, []);

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

  return hasSession ? (
    <Redirect href="/(main)/(tabs)" />
  ) : (
    <Redirect href="/(auth)/sign-in" />
  );
}
