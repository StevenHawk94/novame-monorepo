import { Tabs } from 'expo-router';

/**
 * Bottom tabs navigator.
 *
 * Stage 3.1: Default Tabs UI (system-rendered tab bar).
 * Stage 3.6: Will be replaced with custom tabBar component matching
 *            NovaMe BottomNav design (4 tabs + center mic button,
 *            dark background #0A0A0F, purple accent #C084FC).
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="assets" options={{ title: 'Assets' }} />
    </Tabs>
  );
}
