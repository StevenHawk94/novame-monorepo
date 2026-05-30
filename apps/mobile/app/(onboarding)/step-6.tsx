import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ImgPage, PrimaryButton } from '@/components/onboarding/shared';

/**
 * Step 6 — "You won't grow by copying someone else's story."
 *
 * Static copy screen. Image background ob-6.webp.
 */
export default function OnboardingStep6() {
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
          You won&apos;t grow by copying someone else&apos;s story.
        </Text>
        <Text style={styles.body}>
          True growth comes from your own story — your raw, unfiltered experiences already hold the wisdom you’ve been searching for.
        </Text>
      </View>
    </ImgPage>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 12,
  },
  body: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    textAlign: 'center',
  },
});
