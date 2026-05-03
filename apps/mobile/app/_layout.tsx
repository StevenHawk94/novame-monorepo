import { Stack } from 'expo-router';

/**
 * Root layout for @novame/mobile.
 *
 * Stage 2.2: Stack-only placeholder.
 * Stage 2.3 will add Provider scaffolding (GestureHandlerRootView,
 * SafeAreaProvider, QueryClientProvider, ThemeProvider) around <Stack />.
 */
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
