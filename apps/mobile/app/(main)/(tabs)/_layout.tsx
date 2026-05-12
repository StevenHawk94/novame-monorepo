import { useEffect, useState } from 'react';

import { Tabs } from 'expo-router';

import { BottomTabBar } from '@/components/main/bottom-tab-bar';
import { SkinUnlockModal } from '@/components/modals/skin-unlock-modal';
import { useSkinUnlockHead } from '@/lib/skin-unlock-store';
import { getCurrentSession } from '@/lib/auth';

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
  // Stage 5.WR.2 (Bug 3): subscribe to the global skin-unlock queue
  // and render SkinUnlockModal whenever a queued unlock is ready to
  // show. Renders here (in the tabs layout) rather than in any single
  // tab so that completing a daily task in Growth, recording in
  // record modal, or just opening the app on Home all flow through
  // the same modal surface.
  const queueHead = useSkinUnlockHead();
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    // Cache the user id once for the modal's switchOutfit call.
    // It's stable for the lifetime of this layout (signing out
    // unmounts everything via _layout.tsx router.replace).
    void getCurrentSession().then((s) => setUserId(s?.user?.id ?? null));
  }, []);

  return (
    <>
      <Tabs
        tabBar={(props) => <BottomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="growth" options={{ title: 'Growth' }} />
        <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
        <Tabs.Screen name="assets" options={{ title: 'Assets' }} />
      </Tabs>
      {queueHead !== undefined ? (
        <SkinUnlockModal outfitNum={queueHead} userId={userId} />
      ) : null}
    </>
  );
}
