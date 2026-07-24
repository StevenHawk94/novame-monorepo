import { Stack } from 'expo-router';

/**
 * Authenticated app layout.
 *
 * useStudyClaimDetector() went with the willpower system (D5).
 *
 * reflect and focus inherit the fullScreenModal presentation that record had,
 * for the reason record had it: it is the only iOS presentation that actually
 * disables the downward dismiss gesture. `gestureEnabled: false` on a plain
 * 'modal' yields a rubber-band bounce (react-native-screens #1410), and
 * expo-router ignores `presentation` on a screen inside a nested layout
 * (#37680) -- which is why these two files sit directly under (main)/ rather
 * than in (modals)/. Losing an unpublished reflection to a stray swipe is not
 * a recoverable error.
 */
export default function MainLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0F0B2E' },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
      <Stack.Screen
        name="ai-consent"
        options={{ presentation: 'transparentModal', animation: 'fade' }}
      />
      <Stack.Screen name="reflect" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="reflect-typing" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="reflect-guided" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="reflect-items" options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="focus" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
