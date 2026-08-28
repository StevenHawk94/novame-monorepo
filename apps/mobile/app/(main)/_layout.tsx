import { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { ratingNavigationListeners, resetNavigationTransitions } from '@/lib/rating-navigation';

import { OfficialRatingGate } from '@/components/rating/official-rating-gate';
import { HomeEntryGate } from '@/components/main/home-entry-gate';
import { useReflectSettlementRecovery } from '@/lib/use-reflect-settlement-recovery';

/**
 * Authenticated app layout.
 *
 * useStudyClaimDetector() went with the willpower system (D5).
 *
 * Focus/Reflect entry pickers use ordinary stack cards, not separately presented
 * transparent native modals. Navigation owns both their visible exit and touch
 * release, avoiding an invisible modal container over Home. Their input/session child
 * routes remain fullScreenModal and do not mount that gesture; losing an
 * unpublished reflection to a stray swipe is not recoverable.
 *
 * The companion sheet also lives in this stack instead of a React Native
 * Modal. Kit routes can therefore slide over it and pop back to the exact
 * still-mounted sheet without a close/reopen flash.
 */
export default function MainLayout() {
  useReflectSettlementRecovery();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') resetNavigationTransitions();
    });
    return () => { subscription.remove(); resetNavigationTransitions(); };
  }, []);
  return (
    <HomeEntryGate>
      <Stack
        screenListeners={ratingNavigationListeners}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#4C331B' },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(modals)" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="item-sheet"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            gestureEnabled: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="ai-consent"
          options={{ presentation: 'transparentModal', animation: 'fade' }}
        />
        <Stack.Screen
          name="companion-sheet"
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            gestureEnabled: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="quiet-wins" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="new-lens" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="true-north" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="tame-enemy" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen name="visit-master" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
        <Stack.Screen
          name="reflect"
          options={{
            presentation: 'card',
            animation: 'slide_from_bottom',
            animationDuration: 250,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="reflect-typing" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="reflect-guided" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="shared-memory-create" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen
          name="focus"
          options={{
            presentation: 'card',
            animation: 'slide_from_bottom',
            animationDuration: 250,
            gestureEnabled: false,
          }}
        />
      </Stack>
      <OfficialRatingGate />
    </HomeEntryGate>
  );
}
