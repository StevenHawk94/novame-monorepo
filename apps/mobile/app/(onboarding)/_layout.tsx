import { Stack } from 'expo-router';

/**
 * Pre-auth onboarding layout. A single screen (index) for now -- the intro,
 * paywall, and naming are one file with an internal step index, so this
 * just hides the header and matches the beige grid background.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F8E2C1' },
      }}
    />
  );
}
