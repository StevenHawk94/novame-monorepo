import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton, Shell } from '@/components/onboarding/shared';
import { S7_OPTS } from '@/components/onboarding/constants';
import { haptics } from '@/lib/haptics';
import {
  getOnboardingState,
  patchOnboardingState,
} from '@/lib/onboarding';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

/**
 * Step 7 — "Why did you open NovaMe today?"
 *
 * Single-select A/B/C/D, but selection does NOT auto-advance.
 * Instead a "✨ Transform My Answer" CTA is enabled once a choice
 * is made (gives the user a deliberate moment of commitment before
 * the spinning animation reveals their first card).
 */
export default function OnboardingStep7() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const router = useRouter();
  const initial = getOnboardingState().s7;
  const [picked, setPicked] = useState<'A' | 'B' | 'C' | 'D' | null>(initial);

  const select = (key: 'A' | 'B' | 'C' | 'D') => {
    setPicked(key);
    patchOnboardingState({ s7: key });
  };

  return (
    <Shell step={7} onBack={() => router.back()}>
      <View style={styles.body}>
        <Text style={styles.headline}>What brought you here today?</Text>
        <Text style={styles.subheadline}>
          No filter needed. Just type the first thing that comes to mind
        </Text>
        <View style={styles.options}>
          {S7_OPTS.map((opt) => {
            const active = picked === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => { void haptics.light(); select(opt.key); }}
                style={[styles.option, active && styles.optionActive]}
              >
                <Text style={styles.optionLabel}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.footer}>
        <PrimaryButton
          disabled={!picked}
          onPress={() => router.push('/(onboarding)/step-spinning')}
        >
          ✨ Transform My Answer
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
  body: {
    flex: 1,
    paddingHorizontal: scale(24),
    justifyContent: 'center',
  },
  headline: {
    color: '#FFFFFF',
    ...t.title2,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: scale(8),
  },
  subheadline: {
    color: 'rgba(255,255,255,0.6)',
    ...t.footnote,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: scale(24),
  },
  options: {
    gap: 12,
  },
  option: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  optionActive: {
    backgroundColor: 'rgba(168,85,247,0.2)',
    borderColor: 'rgba(168,85,247,0.5)',
  },
  optionLabel: {
    color: '#FFFFFF',
    ...t.footnote,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
  },
  footer: {
    paddingHorizontal: scale(24),
    paddingBottom: scale(24),
  },
  });
}
