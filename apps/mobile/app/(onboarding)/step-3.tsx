import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getOnboardingState } from '@/lib/onboarding';

/**
 * Step 3 — Word scroller animation.
 *
 * Each picked aspire word fades in for 500ms then fades out (350ms),
 * one after the other. After the last word, shows "That's a beautiful
 * vision. ✨" for 2.2 seconds, then auto-advances to step 4.
 *
 * No back button — this is a kinetic transition between input
 * (step 2) and the next question (step 4).
 *
 * If somehow the user landed here with no words picked (would only
 * happen via direct deep link, not normal flow), we skip straight
 * to step 4.
 */

const FADE_IN_MS = 500;
const FADE_OUT_MS = 350;
const FINISH_HOLD_MS = 2200;

export default function OnboardingStep3() {
  const router = useRouter();
  const words = getOnboardingState().aspireWords;
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'in' | 'out' | 'done'>('in');

  useEffect(() => {
    if (words.length === 0) {
      router.replace('/(onboarding)/step-4');
      return;
    }
    if (phase === 'done') {
      const t = setTimeout(() => router.push('/(onboarding)/step-4'), FINISH_HOLD_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'in') {
      const t = setTimeout(() => setPhase('out'), FADE_IN_MS);
      return () => clearTimeout(t);
    }
    // phase === 'out'
    const t = setTimeout(() => {
      if (index < words.length - 1) {
        setIndex((i) => i + 1);
        setPhase('in');
      } else {
        setPhase('done');
      }
    }, FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [index, phase, router, words.length]);

  if (words.length === 0) return null;

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        {phase !== 'done' ? (
          <Text style={[styles.word, phase === 'out' && styles.wordOut]}>
            {words[index]}
          </Text>
        ) : (
          <Text style={styles.finish}>That&apos;s a beautiful vision. {'✨'}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0820',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  word: {
    color: '#FFFFFF',
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  wordOut: {
    opacity: 0.3,
  },
  finish: {
    color: '#C084FC',
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
});
