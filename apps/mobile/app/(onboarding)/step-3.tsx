import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { getOnboardingState } from '@/lib/onboarding';

/**
 * Step 3 — Aspire-words celebration (Stage 3.5.bugfix.C, 2025-11-XX).
 *
 * Complete rewrite using RN built-in Animated API instead of
 * react-native-reanimated. Reanimated worklets had race conditions
 * with the layout layer in the previous attempt — children with
 * opacity=0 inside absolutely-positioned siblings collapsed the
 * flex layer below.
 *
 * New design:
 *   - Single-phase render driven by `phase` state ('words' | 'spark'
 *     | 'final').
 *   - Each phase replaces the previous via conditional render — no
 *     overlapping absolute layers, no z-fighting.
 *   - Each chip / sparkle / final-line owns its own Animated.Value
 *     pair (opacity + scale) and runs Animated.timing on mount.
 *
 * Timeline:
 *   0.0s → 1.4s   words: stagger-in (100ms each), then stay visible
 *   1.4s          phase='spark'
 *   1.4s → 2.2s   purple sparkle scales 0→1.15 + rotates 360°
 *   2.2s          phase='final'
 *   2.2s → 3.8s   final-line bounces in, holds
 *   3.8s          navigate to step-4
 */

const NAV_DELAY_MS = 3800;
const WORDS_HOLD_MS = 1400;
const SPARK_HOLD_MS = 800;

type Phase = 'words' | 'spark' | 'final';

export default function OnboardingStep3() {
  const router = useRouter();
  const words = getOnboardingState().aspireWords;
  const [phase, setPhase] = useState<Phase>('words');

  useEffect(() => {
    if (words.length === 0) {
      router.replace('/(onboarding)/step-4');
      return;
    }

    const t1 = setTimeout(() => setPhase('spark'), WORDS_HOLD_MS);
    const t2 = setTimeout(() => setPhase('final'), WORDS_HOLD_MS + SPARK_HOLD_MS);
    const t3 = setTimeout(
      () => router.push('/(onboarding)/step-4'),
      NAV_DELAY_MS,
    );

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [router, words.length]);

  if (words.length === 0) return null;

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        {phase === 'words' && <WordsCloud words={words} />}
        {phase === 'spark' && <Sparkle />}
        {phase === 'final' && <FinalLine />}
      </View>
    </View>
  );
}

// ---- WordsCloud — staggered entry of all picked words ----

function WordsCloud({ words }: { words: string[] }) {
  return (
    <View style={styles.wordsLayer}>
      {words.map((word, i) => (
        <WordChip key={word} word={word} delay={i * 100} />
      ))}
    </View>
  );
}

function WordChip({ word, delay }: { word: string; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 380,
        delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        delay,
        damping: 12,
        stiffness: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale, delay]);

  return (
    <Animated.View
      style={[
        styles.chip,
        { opacity, transform: [{ scale }] },
      ]}
    >
      <Text style={styles.chipText}>{word}</Text>
    </Animated.View>
  );
}

// ---- Sparkle — rotating + scaling purple star ----

function Sparkle() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0)).current;
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.2,
          duration: 500,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.95,
          duration: 200,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(rot, {
        toValue: 1,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale, rot]);

  const rotate = rot.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ scale }, { rotate }],
      }}
    >
      <Text style={styles.sparkleGlyph}>{'✨'}</Text>
    </Animated.View>
  );
}

// ---- FinalLine — playful spring bounce ----

function FinalLine() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.15,
          duration: 280,
          easing: Easing.out(Easing.back(2)),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 0.95,
          duration: 140,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          damping: 10,
          stiffness: 180,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [opacity, scale]);

  return (
    <Animated.View
      style={[
        styles.finalWrap,
        { opacity, transform: [{ scale }] },
      ]}
    >
      <Text style={styles.finalText}>
        Wow, That's a beautiful version!
      </Text>
    </Animated.View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0820',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    width: '100%',
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordsLayer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(168,85,247,0.5)',
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textShadowColor: 'rgba(192,132,252,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  sparkleGlyph: {
    fontSize: 96,
    color: '#C084FC',
    textShadowColor: 'rgba(168,85,247,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  finalWrap: {
    paddingHorizontal: 24,
  },
  finalText: {
    color: '#C084FC',
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    textShadowColor: 'rgba(168,85,247,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
});
