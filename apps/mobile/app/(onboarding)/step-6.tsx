import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ImgPage, PrimaryButton } from '@/components/onboarding/shared';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

/**
 * Step 6 — "You won't grow by copying someone else's story."
 *
 * Static copy screen. Image background ob-6.webp.
 */
export default function OnboardingStep6() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const router = useRouter();
  return (
    <ImgPage
      imgSource={require('@/../assets/images/onboarding/ob-6.webp')}
      btn={
        <PrimaryButton onPress={() => router.push('/(onboarding)/step-7')}>
          Continue
        </PrimaryButton>
      }
    >
      <View style={styles.center}>
        <Text style={styles.headline}>
          Nobody else’s journey can teach you yours.
        </Text>
        <Text style={styles.body}>
          The answers you actually need are already inside your daily moments.
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
  });
}
