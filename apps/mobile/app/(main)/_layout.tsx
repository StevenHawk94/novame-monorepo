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
    <Stack
      screenOptions={{
        headerShown: false,
        // Re-pin the app's #0F0B2E dark-purple theme for the authenticated
        // app. The root Stack default is now black (for a seamless startup
        // gap); pinning it here keeps Home / tabs / modals visually identical
        // and avoids any black flash on signed-in cold start.
        contentStyle: { backgroundColor: '#0F0B2E' },
      }}
    >
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
      {/* record is the "publish wisdom" capture flow (record / type / publish /
          analyze / insight). It used to live inside (modals)/ with the default
          'modal' presentation, which let users dismiss with a downward swipe --
          a documented loss-of-work foot-gun. We promote it to a top-level
          screen under (main)/ with 'fullScreenModal' presentation so:
            - the slide-up entry animation is preserved (matches old UX), AND
            - the iOS downward dismiss gesture is not available at all.
          'fullScreenModal' is the only reliable way to disable the dismiss
          gesture on iOS (gestureEnabled:false on a 'modal' presentation only
          produces a rubber-band bounce per react-native-screens issue #1410).
          Furthermore, expo-router does not honor presentation set on a screen
          inside a nested layout (issue #37680), which is why the screen file
          itself had to move out of (modals)/ rather than just adding options
          there. */}
      <Stack.Screen
        name="record"
        options={{ presentation: 'fullScreenModal' }}
      />
    </Stack>
  );
}
