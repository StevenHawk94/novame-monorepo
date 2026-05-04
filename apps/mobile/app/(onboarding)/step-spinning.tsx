import { useRouter } from 'expo-router';

import { CardSpinStub } from '@/components/onboarding/stubs';

/**
 * Spinning transition between step 7 and step 8.
 *
 * Stage 3.5 uses CardSpinStub (ActivityIndicator + label) which
 * after 3000ms calls onDone. We then router.replace to step-8
 * (replace, not push, so the user cannot swipe back to the
 * spinner — the moment is consumed).
 *
 * Stage 3.8 will swap CardSpinStub for the real reanimated 3D
 * spin without changing this file's behavior.
 */
export default function OnboardingStepSpinning() {
  const router = useRouter();
  return (
    <CardSpinStub
      label1="Crafting your first Wisdom Card..."
      sublabel="Just a moment"
      duration={3000}
      onDone={() => router.replace('/(onboarding)/step-8')}
    />
  );
}
