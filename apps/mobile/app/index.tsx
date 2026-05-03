import { Redirect } from 'expo-router';

/**
 * Stage 3.2 temporary redirect for development build verification.
 *
 * Stage 3.5 (onboarding flow) will replace this with proper logic:
 *   - Check MMKV for "onboarding-done" flag → redirect to (onboarding) or (auth) or (main)
 *
 * Right now this just jumps to (main)/(tabs) so we can verify the
 * 4-tab UI renders correctly in the dev build.
 */
export default function Index() {
  return <Redirect href="/(main)/(tabs)" />;
}
