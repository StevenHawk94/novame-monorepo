import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Shell } from '@/components/onboarding/shared';
import { S4_OPTS } from '@/components/onboarding/constants';
import { patchOnboardingState } from '@/lib/onboarding';
import { haptics } from '@/lib/haptics';
import { useResponsive, useTextStyle } from '@/hooks/use-responsive';

/**
 * Step 4 — "How far away does that version of you feel right now?"
 *
 * Single-select A/B/C. Selection persists to MMKV and immediately
 * advances to step 5 (which renders the response copy keyed by
 * the choice).
 */
export default function OnboardingStep4() {
  const { scale } = useResponsive();
  const t = useTextStyle();
  const styles = useMemo(() => makeStyles(scale, t), [scale, t]);
  const router = useRouter();

  const handleSelect = (key: 'A' | 'B' | 'C') => {
    patchOnboardingState({ sa: key });
    router.push('/(onboarding)/step-5');
  };

  return (
    <Shell step={4} onBack={() => router.back()}>
      <View style={styles.body}>
        <Text style={styles.headline}>Be honest with yourself.</Text>
        <Text style={styles.subheadline}>
          How far away does that version of you feel right now?
        </Text>
        <View style={styles.options}>
          {S4_OPTS.map((opt) => (
            <Pressable
              key={opt.key}
              onPress={() => { void haptics.light(); handleSelect(opt.key); }}
              style={({ pressed }) => [
                styles.option,
                pressed && styles.optionPressed,
              ]}
            >
              <Text style={styles.optionKey}>{opt.key}</Text>
              <Text style={styles.optionLabel}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
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
    color: 'rgba(255,255,255,0.8)',
    ...t.headline,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginBottom: scale(32),
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionPressed: {
    transform: [{ scale: 0.98 }],
  },
  optionKey: {
    color: 'rgba(255,255,255,0.3)',
    ...t.callout,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
  },
  optionLabel: {
    color: '#FFFFFF',
    ...t.callout,
    fontWeight: '500',
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  });
}
