import { Stack } from 'expo-router';

/**
 * Main authenticated app layout.
 *
 * Wraps the entire post-login app:
 *   (tabs)   — bottom tab bar with 4 main views (Home/Growth/Discover/Assets)
 *   (modals) — overlay routes (Me, paywall, settings, etc.) with iOS modal
 *              presentation (slide up from bottom)
 *
 * D18 (Tabs as expo-router standard) + D22 ((modals) group) decisions.
 * Stage 3.6 will replace default Tabs with custom NovaMe BottomNav UI.
 */
export default function MainLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
