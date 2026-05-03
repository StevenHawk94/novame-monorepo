import '../global.css';

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/theme';
import { supabase } from '@/lib/supabase';

/**
 * Root layout for @novame/mobile.
 *
 * Provider tree (outer to inner) — D7 decision A (minimum set):
 *   GestureHandlerRootView    — gesture root (must be outermost)
 *   SafeAreaProvider          — safe area inset calculation
 *   ThemeProvider             — day/night theme via @novame/ui-tokens
 *   <Stack />                 — expo-router file-based routes
 *
 * Stage 4 will add QueryClientProvider for optimistic updates.
 * Stage 3 may add expo-splash-screen prevent/hide control (B14).
 *
 * The global.css import is required by NativeWind v5 — it loads
 * Tailwind utilities and the @theme block defined in mobile root.
 *
 * ----
 * Stage 3.4 — Auth state lifecycle:
 *
 * 1. AppState listener:
 *    - When app comes to foreground → supabase.auth.startAutoRefresh()
 *    - When app goes background → supabase.auth.stopAutoRefresh()
 *    - This is the Supabase-recommended pattern for React Native;
 *      it prevents token refreshes from running while the app is
 *      backgrounded (saves battery, avoids stale state on resume).
 *
 * 2. onAuthStateChange listener (global lifecycle):
 *    - SIGNED_IN  → router.replace to /(main)/(tabs)
 *    - SIGNED_OUT → router.replace to /(auth)/sign-in
 *    - This is what makes sign-out from any screen (e.g. Me page)
 *      automatically navigate back to auth. Individual screens do
 *      not call router themselves on auth changes.
 *    - INITIAL_SESSION fires once on startup; we ignore it here
 *      because app/index.tsx handles startup redirect explicitly
 *      via getCurrentSession() (avoids race between this listener
 *      and the initial Redirect).
 */
export default function RootLayout() {
  useEffect(() => {
    // ---- AppState: control auto-refresh based on foreground/background ----
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };
    // Run once on mount to set the initial state correctly.
    handleAppStateChange(AppState.currentState);
    const appStateSub = AppState.addEventListener('change', handleAppStateChange);

    // ---- onAuthStateChange: drive navigation on sign-in / sign-out ----
    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        router.replace('/(main)/(tabs)');
      } else if (event === 'SIGNED_OUT') {
        router.replace('/(auth)/sign-in');
      }
      // INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED: no-op here.
    });

    return () => {
      appStateSub.remove();
      authSub.unsubscribe();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
