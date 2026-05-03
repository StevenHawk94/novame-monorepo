import { Stack } from 'expo-router';

/**
 * Main authenticated app layout placeholder.
 *
 * Stage 3 will add tabs / screens for journal, cards, profile,
 * settings, etc.
 */
export default function MainLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
