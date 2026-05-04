import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton, Shell } from '@/components/onboarding/shared';
import { ASPIRE_WORDS } from '@/components/onboarding/constants';
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

  const toggle = (word: string) => {
    setSelected((prev) => {
      let next: string[];
      if (prev.includes(word)) {
        next = prev.filter((w) => w !== word);
      } else if (prev.length < 6) {
        next = [...prev, word];
      } else {
        next = prev; // already 6 picked
      }
      patchOnboardingState({ aspireWords: next });
      return next;
    });
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
        <View style={styles.chipGrid}>
          {ASPIRE_WORDS.map((word) => {
            const active = selected.includes(word);
            return (
              <Pressable
                key={word}
                onPress={() => toggle(word)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {active ? '✓ ' : ''}
                  {word}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipActive: {
    backgroundColor: 'rgba(168,85,247,0.25)',
    borderColor: 'rgba(168,85,247,0.6)',
  },
  chipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  chipTextActive: {
    color: '#C084FC',
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
