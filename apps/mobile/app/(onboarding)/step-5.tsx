import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { ImgPage, PrimaryButton } from '@/components/onboarding/shared';
import { S4_RESP } from '@/components/onboarding/constants';
import { getOnboardingState } from '@/lib/onboarding';

/**
 * Step 5 — Response keyed by sa choice from step 4.
 *
 * If sa is somehow null (deep-link / state corruption), we fall
 * back to the B response (the most neutral and encouraging one).
 */
export default function OnboardingStep5() {
  const router = useRouter();
  const sa = getOnboardingState().sa;
  const text = (sa && S4_RESP[sa]) || S4_RESP.B;

  return (
    <ImgPage
      imgSource={require('@/../assets/images/onboarding/ob-5.webp')}
      btn={
        <PrimaryButton onPress={() => router.push('/(onboarding)/step-6')}>
          Continue
        </PrimaryButton>
      }
    >
      <Text style={styles.headline}>{text}</Text>
    </ImgPage>
  );
}

const styles = StyleSheet.create({
  headline: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    lineHeight: 30,
  },
});
