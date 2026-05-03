import { Stack } from 'expo-router';

/**
 * Modal route group layout.
 *
 * Stack with default headerShown: false. Modal presentation behavior
 * (slide up from bottom) is set on the parent at (main)/_layout.tsx
 * via Stack.Screen options.
 *
 * Stage 3.1: All 12 modal routes use the default 'modal' presentation.
 * Stage 3.6+: Individual modals may override presentation as needed
 * (e.g. record / subscription-paywall might use 'fullScreenModal').
 */
export default function ModalsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
