import { Stack } from 'expo-router';

import { useStudyClaimDetector } from '@/hooks/use-study-claim-detector';

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
  // Single global listener for the end-of-study-session claim modal.
  // Mounted here so it survives tab switches and modal navigation.
  useStudyClaimDetector();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
      {/* ai-consent is a transparent overlay that preserves the spatial
          context of the screen behind it. Per official expo-router docs
          (docs.expo.dev/router/advanced/modals), transparentModal must
          be applied to the SCREEN file name -- not a group container.
          Hence ai-consent.tsx lives directly under (main)/, NOT inside
          a (modals) or (overlays) group. The screen's own UI renders
          the purple card and dark backdrop; this layout just controls
          how it's presented over the screen it was pushed from. */}
      <Stack.Screen
        name="ai-consent"
        options={{ presentation: 'transparentModal', animation: 'fade' }}
      />
    </Stack>
  );
}
