import { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton, Shell } from '@/components/onboarding/shared';
import { AspireWordsPicker } from '@/components/onboarding/aspire-words-picker';
import {
  getOnboardingState,
  patchOnboardingState,
} from '@/lib/onboarding';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

/**
 * Step 2 — "How would you describe your ideal self?" word selector.
 *
 * Tap to toggle 4-6 chips. Continue button enables once 4+ are picked
 * and disables again if user picks fewer than 4. State persists to
 * MMKV on every change so back/forward navigation does not lose
 * selections.
 */
export default function OnboardingStep2() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const router = useRouter();
  const initial = getOnboardingState().aspireWords;
  const [selected, setSelected] = useState<string[]>(initial);

  const handleChange = (next: string[]) => {
    setSelected(next);
    patchOnboardingState({ aspireWords: next });
  };

  const canContinue = selected.length >= 4;

  return (
    <Shell step={2} onBack={() => router.back()}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headline}>Let’s start with you.</Text>
        <Text style={styles.subheadline}>
          When you imagine the version of yourself you’re working toward, which words feel like that person?
        </Text>
        <Text style={styles.hint}>Pick 4 to 6. Don’t overthink it.</Text>
        <AspireWordsPicker selected={selected} onChange={handleChange} />
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.counter}>{selected.length}/6 selected</Text>
        <PrimaryButton
          disabled={!canContinue}
          onPress={() => router.push('/(onboarding)/step-3')}
        >
          Continue
        </PrimaryButton>
      </View>
    </Shell>
  );
}

function makeStyles(
  scale: (n: number) => number,
  t: ReturnType<typeof useTextStyle>,
) {
  return StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: scale(24),
    paddingTop: scale(16),
  },
  headline: {
    color: '#FFFFFF',
    ...t.title2,
    fontFamily: 'Inter_700Bold',
    marginBottom: scale(4),
  },
  subheadline: {
    color: 'rgba(255,255,255,0.9)',
    ...t.title2,
    fontFamily: 'Inter_700Bold',
    marginBottom: scale(8),
  },
  hint: {
    color: 'rgba(255,255,255,0.4)',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    marginBottom: scale(20),
  },
  footer: {
    paddingHorizontal: scale(24),
    paddingTop: scale(8),
    paddingBottom: scale(24),
    gap: scale(12),
  },
  counter: {
    color: 'rgba(255,255,255,0.3)',
    ...t.caption,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  });
}
