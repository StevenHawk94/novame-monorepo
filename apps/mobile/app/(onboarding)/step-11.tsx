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
 * Background: ob-11.webp is not yet committed to git (user will
 * add it post-stage-3.5). The Image render falls back to a flat
 * dark navy background until the file is added.
 */
export default function OnboardingStep11() {
  const router = useRouter();
  const charName = getOnboardingState().charName.trim();

  const handleStart = () => {
    markOnboardingComplete();
    router.replace('/(auth)/sign-in');
  };

  return (
    <ImgPage
      btn={<PrimaryButton onPress={handleStart}>Start My Journey</PrimaryButton>}
    >
      <View style={styles.center}>
        <Text style={styles.headline}>Your journey begins now.</Text>
        <Text style={styles.body}>
          Anything on your mind belongs here. Simply release a passing thought,
          a sudden mood, or a tiny moment from your day.{' '}
          <Text style={styles.charName}>{charName}</Text>{' '}
          will decode it into a lesson, helping you step into the version of
          yourself you&apos;ve always wanted to meet.
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
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
    textAlign: 'center',
  },
  charName: {
    color: '#C084FC',
    fontFamily: 'Inter_700Bold',
  },
});
