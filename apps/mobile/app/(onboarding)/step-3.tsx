import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import LottieView from 'lottie-react-native';

import { getOnboardingState } from '@/lib/onboarding';

/**
 * Step 3 — Aspire-words celebration with Tap Burst (Stage 6.x).
 *
 * 4-phase choreography:
 *   Phase 1 'words'      0.0s → 1.4s   chips stagger-in, glow purple
 *   Phase 2 'converge'   1.4s → 2.0s   chips fly to center, shrink + fade
 *   Phase 3 'burst'      2.0s → 3.0s   Tap-Burst lottie explodes (1s)
 *   Phase 4 'final'      2.7s → 4.5s   "Wow..." text bounces in (overlaps
 *                                       lottie tail by 0.3s for seamless
 *                                       handoff)
 *   Navigate at 4.5s.
 *
 * Implementation: pure RN Animated API for the chip motion (cheap,
 * reliable), Lottie native renderer for the burst (designer-controlled
 * visuals).
 */

const PHASE_DURATIONS = {
  WORDS: 1400,
  CONVERGE: 600,
  BURST: 1000,
  FINAL_HOLD: 1500,
};
const FINAL_OVERLAP_MS = 300; // final text appears 300ms before burst ends
const NAV_DELAY_MS =
  PHASE_DURATIONS.WORDS +
  PHASE_DURATIONS.CONVERGE +
  PHASE_DURATIONS.BURST +
  PHASE_DURATIONS.FINAL_HOLD;

const TAP_BURST_LOTTIE = require('../../assets/animations/tap-burst.json');

const SCREEN = Dimensions.get('window');
const CENTER_X = SCREEN.width / 2;
const CENTER_Y = SCREEN.height / 2;

type Phase = 'words' | 'converge' | 'burst' | 'final';

export default function OnboardingStep3() {
  const router = useRouter();
  const words = getOnboardingState().aspireWords;
  const [phase, setPhase] = useState<Phase>('words');

  useEffect(() => {
    if (words.length === 0) {
      router.replace('/(onboarding)/step-4');
      return;
    }

    const t1 = setTimeout(() => setPhase('converge'), PHASE_DURATIONS.WORDS);
    const t2 = setTimeout(
      () => setPhase('burst'),
      PHASE_DURATIONS.WORDS + PHASE_DURATIONS.CONVERGE,
    );
    const t3 = setTimeout(
      () => setPhase('final'),
      PHASE_DURATIONS.WORDS +
        PHASE_DURATIONS.CONVERGE +
        PHASE_DURATIONS.BURST -
        FINAL_OVERLAP_MS,
    );
    const t4 = setTimeout(
      () => router.push('/(onboarding)/step-4'),
      NAV_DELAY_MS,
    );

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [router, words.length]);

  if (words.length === 0) return null;

  return (
    <View style={styles.root}>
      {/* Words layer — visible during phase=words AND converge.
          During converge each chip animates its own translate to center. */}
      {(phase === 'words' || phase === 'converge') && (
        <View style={styles.absLayer} pointerEvents="none">
          <View style={styles.wordsLayer}>
            {words.map((word, i) => (
              <WordChip
                key={word}
                word={word}
                inDelay={i * 100}
                converging={phase === 'converge'}
                convergeDelay={i * 30}
              />
            ))}
          </View>
        </View>
      )}

      {/* Burst layer — Lottie centered, plays once. */}
      {(phase === 'burst' || phase === 'final') && (
        <View style={styles.absLayer} pointerEvents="none">
          <LottieView
            source={TAP_BURST_LOTTIE}
            autoPlay
            loop={false}
            style={styles.lottie}
            resizeMode="contain"
          />
        </View>
      )}

      {/* Final text — overlaps the lottie tail. */}
      {phase === 'final' && (
        <View style={styles.absLayer} pointerEvents="none">
          <FinalLine />
        </View>
      )}
    </View>
  );
}

// ---- WordChip — handles BOTH stagger-in AND converge-to-center ----

function WordChip({
  word,
  inDelay,
  converging,
  convergeDelay,
}: {
  word: string;
  inDelay: number;
  converging: boolean;
  convergeDelay: number;
}) {
  // Stagger-in (opacity + scale-up from 0.7 to 1)
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.7)).current;

  // Converge: each chip captures its initial onLayout center, then
  // animates dx/dy to (0,0) relative to current position. We use a
  // separate Animated.Value driver in [0,1] and interpolate to the
  // negative offset, so each chip flies to screen center regardless
  // of where it started in the wordsLayer flex grid.
  const convergeProgress = useRef(new Animated.Value(0)).current;
  const [layout, setLayout] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 380,
        delay: inDelay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        delay: inDelay,
        damping: 12,
        stiffness: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale, inDelay]);

  useEffect(() => {
    if (!converging) return;
    Animated.parallel([
      Animated.timing(convergeProgress, {
        toValue: 1,
        duration: 500,
        delay: convergeDelay,
        easing: Easing.in(Easing.quad), // accelerate INTO the center
        useNativeDriver: true,
      }),
      // Shrink + fade out as it approaches center
      Animated.timing(scale, {
        toValue: 0.2,
        duration: 500,
        delay: convergeDelay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 500,
        delay: convergeDelay + 200, // start fading after some travel
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [converging, convergeProgress, opacity, scale, convergeDelay]);

  // From layout, compute offset to screen center.
  // dx = CENTER_X - (chip.x + chip.w/2), same for y.
  const dx = layout
    ? CENTER_X - (layout.x + layout.w / 2)
    : 0;
  const dy = layout
    ? CENTER_Y - (layout.y + layout.h / 2)
    : 0;

  const translateX = convergeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, dx],
  });
  const translateY = convergeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, dy],
  });

  return (
    <Animated.View
      onLayout={(e) => {
        // Capture absolute window coords once for converge math.
        e.target?.measureInWindow?.((x, y, w, h) => {
          setLayout({ x, y, w, h });
        });
      }}
      style={[
        styles.chip,
        {
          opacity,
          transform: [
            { translateX },
            { translateY },
            { scale },
          ],
        },
      ]}
    >
      <Text style={styles.chipText}>{word}</Text>
    </Animated.View>
  );
}

// ---- FinalLine ----

function FinalLine() {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.15,
          duration: 320,
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
    <View style={styles.finalLayer} pointerEvents="none">
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
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0820',
  },
  absLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordsLayer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(168,85,247,0.18)',
    borderWidth: 1.5,
    borderColor: 'rgba(168,85,247,0.55)',
    // Spherical purple glow effect
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 14,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textShadowColor: 'rgba(192,132,252,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  lottie: {
    width: 320,
    height: 320,
  },
  finalLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
