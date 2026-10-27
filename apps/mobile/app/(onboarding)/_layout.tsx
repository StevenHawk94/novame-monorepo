import { Stack } from 'expo-router';
import { ONBOARDING_CREAM } from '@/lib/burrow-onboarding-design';

/** Feature tour, profile, immediate pairing and optional Plus in one local pager. */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'none',
        gestureEnabled: false,
        contentStyle: { backgroundColor: ONBOARDING_CREAM },
      }}
    />
  );
}
