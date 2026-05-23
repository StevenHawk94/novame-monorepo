import { useState } from 'react';
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

/**
 * Step 2 — "How would you describe your ideal self?" word selector.
 *
 * Tap to toggle 4-6 chips. Continue button enables once 4+ are picked
 * and disables again if user picks fewer than 4. State persists to
 * MMKV on every change so back/forward navigation does not lose
 * selections.
 */
export default function OnboardingStep2() {
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
        <Text style={styles.headline}>Take a deep breath.</Text>
        <Text style={styles.subheadline}>
          How would you describe your ideal self?
        </Text>
        <Text style={styles.hint}>Select 4 to 6 keywords</Text>
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

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 4,
  },
  subheadline: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  hint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginBottom: 20,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 12,
  },
  counter: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});
