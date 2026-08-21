import { Tabs } from 'expo-router';

import { BottomTabBar } from '@/components/main/bottom-tab-bar';

/**
 * Five tabs: Home / Bags / Quests / Friends / Status.
 *
 * SkinUnlockModal and StudyClaimModal are no longer mounted. The first read
 * its unlocked set from character-state and statically require()'d six char-1
 * images; the second belongs to the willpower system. Both re-enter in Phase C
 * -- skins against companions, and nothing against study.
 *
 * Official rating requests are coordinated by the authenticated Main layout,
 * so they can wait for Reflect and paywall routes to finish closing.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="bags" options={{ title: 'Bags' }} />
      <Tabs.Screen name="quests" options={{ title: 'Quests' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="status" options={{ title: 'Connection' }} />
    </Tabs>
  );
}
