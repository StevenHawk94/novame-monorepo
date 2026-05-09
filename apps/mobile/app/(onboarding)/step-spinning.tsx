import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { CardSpinAnimation } from '@/components/cards/CardSpinAnimation';

/**
 * Spinning transition between step 7 and step 8.
 *
 * Stage 3.5 → Stage 3.5.bugfix (2025-11-XX): wraps CardSpinAnimation
 * in a dark navy backdrop matching the rest of the onboarding flow
 * (#0A0820, same as Shell / ImgPage). Without this wrapper, the
 * transparent CardSpinAnimation root let the system default light
 * background show through during the Stack push transition, causing
 * the spinning card to disappear into a near-white bg on iOS.
 *
 * CardSpinAnimation itself is left transparent on purpose so other
 * callers (record.tsx publishing/analyzing phases) can compose it
 * over their own backgrounds.
 *
 * Lifecycle: 'timed' mode, 3000ms then router.replace to step-8
 * (replace, not push, so the user cannot swipe back to the spinner —
 * the moment is consumed).
 */
export default function OnboardingStepSpinning() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <CardSpinAnimation
        label1="Crafting your first Wisdom Card..."
        sublabel="Just a moment"
        duration={3000}
        onDone={() => router.replace('/(onboarding)/step-8')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0820',
  },
});