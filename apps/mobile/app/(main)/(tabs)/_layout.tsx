import { Tabs } from 'expo-router';

import { BottomTabBar } from '@/components/main/bottom-tab-bar';

/**
 * Bottom tabs navigator (stage 3.6).
 *
 * 4 main tabs: Home (index) / Growth / Discover / Assets.
 *
 * The visible tab bar is rendered by our custom BottomTabBar component
 * via the `tabBar` prop. Inside it we draw 4 tab buttons + a centered
 * raised mic button (the mic is a pure overlay, NOT a tab — it
 * router.pushes to (main)/(modals)/record).
 *
 * Header is hidden across all screens. Each screen handles its own
 * top bar (e.g. Home has 4 round buttons: hamburger / skin / weekly
 * report / leaderboard).
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="growth" options={{ title: 'Growth' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="assets" options={{ title: 'Assets' }} />
    </Tabs>
  );
}
