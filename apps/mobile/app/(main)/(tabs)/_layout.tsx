import { useEffect, useRef } from 'react';

import { Tabs } from 'expo-router';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { BottomTabBar } from '@/components/main/bottom-tab-bar';
import {
  RatingPromptSheet,
  type RatingPromptSheetRef,
} from '@/components/rating/rating-prompt-sheet';
import { subscribeRatingPromptRequest } from '@/lib/rating-prompt';

/**
 * Five tabs: Home / Bags / Quests / Friends / Status.
 *
 * SkinUnlockModal and StudyClaimModal are no longer mounted. The first read
 * its unlocked set from character-state and statically require()'d six char-1
 * images; the second belongs to the willpower system. Both re-enter in Phase C
 * -- skins against companions, and nothing against study.
 *
 * The rating sheet stays: it carries no domain concept, it listens on a
 * module-level channel and presents. modal-coordinator likewise survives,
 * arbitrating only announcement-gate until Phase C gives it slots to order.
 */
export default function TabsLayout() {
  const ratingSheetRef = useRef<RatingPromptSheetRef>(null);
  useEffect(() => {
    return subscribeRatingPromptRequest(() => {
      ratingSheetRef.current?.present();
    });
  }, []);

  return (
    <BottomSheetModalProvider>
      <Tabs
        tabBar={(props) => <BottomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="bags" options={{ title: 'Bags' }} />
        <Tabs.Screen name="quests" options={{ title: 'Quests' }} />
        <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
        <Tabs.Screen name="status" options={{ title: 'Me' }} />
      </Tabs>
      <RatingPromptSheet ref={ratingSheetRef} />
    </BottomSheetModalProvider>
  );
}
