import { Stack } from 'expo-router';

/**
 * Pre-auth onboarding layout. A single screen (index) for now -- the intro,
 * pet choice, and paywall are one file with an internal step index, so this
 * just hides the header and matches the dark background.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0F0B2E' },
      }}
    />
  );
}
