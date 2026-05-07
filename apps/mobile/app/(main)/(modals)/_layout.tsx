import { Stack } from 'expo-router';

/**
 * Modal route group layout.
 *
 * Stack with default headerShown: false. Modal presentation behavior
 * (slide up from bottom) is set on the parent at (main)/_layout.tsx
 * via Stack.Screen options.
 *
 * Stage 3.1: All modal routes use the default 'modal' presentation.
 *
 * Stage 3.10.4 update: plan-billing was briefly experimented with as
 * a native UISheetPresentationController half-sheet via formSheet
 * presentation. The native dimming behavior didn't render as expected
 * (background remained un-dimmed even after a clean rebuild) and the
 * approach was replaced with @gorhom/bottom-sheet (industry standard,
 * see src/components/me/plan-billing-sheet.tsx) which gives us full
 * control over backdrop opacity, snap points, and grabber styling.
 *
 * The plan-billing route file was therefore deleted -- plan & billing
 * is now rendered inline on the Me page as a BottomSheetModal that the
 * Me page presents via a ref. Other modals (paywall, ranking,
 * weekly-report, etc.) continue to use the default slide-up modal.
 */
export default function ModalsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
