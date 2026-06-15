import { Stack } from 'expo-router';

/**
 * Onboarding flow layout (stage 3.5).
 *
 * 11 sequential screens (index.tsx + step-2 through step-11) plus
 * a transient step-spinning screen between step 7 and step 8.
 *
 * Stack navigator with slide_from_right transition gives the iOS
 * native push animation, replacing the old Capacitor CSS-only
 * obSlideIn keyframe animation. Visual contract is preserved
 * (each screen slides in from the right) but the implementation
 * is fully native — D3 "皮囊一样底层不一样" principle.
 *
 * gestureEnabled left at the default (true) so users can swipe
 * back from any screen — this is a small UX upgrade over the old
 * Capacitor flow which only had explicit Back buttons.
 *
 * On step 11 finish, screens unmount entirely as the user is
 * redirected to (auth)/sign-in by markOnboardingComplete +
 * onAuthStateChange flow.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        // Onboarding is pure black -- override the root Stack's #0F0B2E
        // theme so the splash->first-paint window is black (seamless),
        // not a dark-purple flash. Home keeps #0F0B2E via the root Stack.
        contentStyle: { backgroundColor: '#000000' },
      }}
    />
  );
}
