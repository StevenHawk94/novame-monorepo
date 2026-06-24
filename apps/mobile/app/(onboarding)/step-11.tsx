import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  ImgPage,
  PrimaryButton,
} from '@/components/onboarding/shared';
import {
  getOnboardingState,
  markOnboardingComplete,
} from '@/lib/onboarding';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

/**
 * Step 11 — Finish.
 *
 * Tapping "Start My Journey":
 *   1. markOnboardingComplete() — sets done=true and pendingSync=true
 *      in MMKV. The pendingSync flag triggers
 *      syncOnboardingDataToServer on the next SIGNED_IN event
 *      (see app/_layout.tsx).
 *   2. router.replace('/(auth)/sign-in') — replace, not push, so
 *      the user cannot swipe back into the onboarding flow.
 *
 * After sign-in, the onAuthStateChange listener will fire SIGNED_IN
 * and navigate to (main)/(tabs), running syncOnboardingIfPending
 * along the way.
 *
 * Background: ob-11.webp lives in apps/mobile/assets/images/onboarding/
 * alongside ob-1..ob-10. If the file is missing the Image render
 * falls back to a flat dark navy background, but the file should
 * be present in any branch building this screen.
 */
export default function OnboardingStep11() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const router = useRouter();
  const charName = getOnboardingState().charName.trim();

  const handleStart = () => {
    markOnboardingComplete();
    router.replace('/(auth)/sign-in');
  };

  return (
    <ImgPage
      imgSource={require('@/../assets/images/onboarding/ob-11.webp')}
      btn={<PrimaryButton onPress={handleStart}>Let’s Go</PrimaryButton>}
    >
      <View style={styles.center}>
        <Text style={styles.headline}>Ready when you are.</Text>
        <Text style={styles.body}>
          Whenever something comes up — a thought, a feeling, a moment you want to hold onto — just tell{' '}
          <Text style={styles.charName}>{charName}</Text>.{'\n'}{'\n'}They’ll help you find what it means.
        </Text>
      </View>
    </ImgPage>
  );
}

function makeStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  headline: {
    color: '#FFFFFF',
    ...t.title2,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: scale(12),
  },
  body: {
    color: 'rgba(255,255,255,0.45)',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  charName: {
    color: '#C084FC',
    fontFamily: 'Inter_700Bold',
  },
  });
}
