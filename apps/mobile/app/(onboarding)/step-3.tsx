import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import LottieView from 'lottie-react-native';

import { getOnboardingState } from '@/lib/onboarding';

/**
 * Step 3 — Aspire-words celebration with Tap Burst.
 *
 * Stage 6.AspireBubbles (2026-05): chips replaced by glowing
 * purple bubble spheres arranged in a non-linear cluster, inspired
 * by the Apple Watch "bubble dial" layout. Each bubble contains
 * one of the user's selected aspire words centered inside.
 *
 * 4-phase choreography:
 *   Phase 1 'words'      0.0s → 1.4s   bubbles stagger-in (scale 0.3→1
 *                                       with bouncy spring), glow purple
 *   Phase 2 'converge'   1.4s → 2.0s   bubbles fly to center, shrink + fade
 *   Phase 3 'burst'      2.0s → 3.0s   Tap-Burst lottie explodes (1s)
 *   Phase 4 'final'      2.7s → 4.5s   "Wow..." text bounces in (overlaps
 *                                       lottie tail by 0.3s for seamless
 *                                       handoff)
 *   Navigate at 4.5s.
 *
 * Implementation: pure RN Animated API for the bubble motion (cheap,
 * reliable), Lottie native renderer for the burst (designer-controlled
 * visuals). Bubble positions come from a predefined cluster layout
 * (4/5/6 word configurations) with a small random jitter applied at
 * mount so the cluster feels organic without ever overlapping.
 */

const PHASE_DURATIONS = {
  WORDS: 1400,
  CONVERGE: 600,
  BURST: 1000,
  FINAL_HOLD: 2500,
};
const FINAL_OVERLAP_MS = 300; // final text appears 300ms before burst ends
const NAV_DELAY_MS =
  PHASE_DURATIONS.WORDS +
  PHASE_DURATIONS.CONVERGE +
  PHASE_DURATIONS.BURST +
  PHASE_DURATIONS.FINAL_HOLD;

const TAP_BURST_LOTTIE = require('../../assets/animations/tap-burst.json');

const SCREEN = Dimensions.get('window');

// Bubble diameter scales with word length so longer words like
// 'Self-Aware' don't overflow the sphere. The container is square
// (width = height = diameter) so the borderRadius=diameter/2 always
// renders a perfect circle.
function bubbleDiameter(word: string): number {
  if (word.length <= 6) return 80;
  if (word.length <= 9) return 92;
  return 104;
}

// Font size auto-shrinks for longer words so the centered text never
// touches the bubble's edge.
function bubbleFontSize(word: string): number {
  if (word.length <= 6) return 16;
  if (word.length <= 9) return 14;
  return 12;
}

// Predefined cluster layouts. Coordinates are offsets from the screen
// center (0,0) before random jitter is applied. Each layout was
// hand-tuned so bubbles never overlap (assuming max diameter ~104pt)
// and the cluster reads as organic-but-balanced. The 6-word config
// borrows the Apple Watch 'bubble dial' geometry — one big bubble
// near center, others orbiting it.
const CLUSTER_LAYOUTS: Record<number, Array<{ x: number; y: number }>> = {
  4: [
    { x: -80, y: -55 },
    { x: 75, y: -50 },
    { x: -60, y: 60 },
    { x: 70, y: 65 },
  ],
  5: [
    { x: 0, y: -85 },
    { x: -95, y: -10 },
    { x: 90, y: 0 },
    { x: -55, y: 85 },
    { x: 65, y: 90 },
  ],
  6: [
    { x: 0, y: 0 },
    { x: -95, y: -75 },
    { x: 90, y: -65 },
    { x: -100, y: 55 },
    { x: 100, y: 65 },
    { x: 0, y: 115 },
  ],
};

// How far (in pt) each bubble can drift from its predefined position.
// Small enough that we never break the no-overlap invariant.
const JITTER_RADIUS = 12;

// Deterministic-ish-but-fresh random offset for each bubble. We use
// Math.random at mount, accept that re-entry will produce a different
// arrangement — that's the design intent (organic feel).
function jitter(): number {
  return (Math.random() - 0.5) * 2 * JITTER_RADIUS;
}

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

  // Compute bubble cluster positions once per mount. We clamp to a
  // supported layout (4-6); step-2 enforces the 4-6 range so any
  // value outside is treated as 4 (degraded gracefully).
  const positions = useMemo(() => {
    const layoutKey = (
      words.length >= 4 && words.length <= 6 ? words.length : 4
    ) as 4 | 5 | 6;
    const base = CLUSTER_LAYOUTS[layoutKey];
    return words.map((_, i) => {
      const slot = base[i % base.length];
      return {
        x: slot.x + jitter(),
        y: slot.y + jitter(),
      };
    });
  }, [words]);

  return (
    <View style={styles.root}>
      {/* Words layer — visible during phase=words AND converge.
          Each bubble is absolutely positioned in the screen-centered
          cluster; converge animates its translate back to (0,0). */}
      {(phase === 'words' || phase === 'converge') && (
        <View style={styles.absLayer} pointerEvents="none">
          {words.map((word, i) => (
            <WordBubble
              key={word}
              word={word}
              startX={positions[i].x}
              startY={positions[i].y}
              inDelay={i * 100}
              converging={phase === 'converge'}
              convergeDelay={i * 30}
            />
          ))}
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

// ---- WordBubble — sphere-shaped variant of the original chip ----
//
// Renders one of the user's aspire words as a glowing purple bubble.
// Two phases:
//   1. Stagger-in: opacity 0→1 + scale 0.3→1 with a bouncy spring,
//      one bubble at a time on a 100ms cadence.
//   2. Converge: bubble translates from its cluster position back to
//      the screen center while shrinking + fading, then the Tap-Burst
//      lottie takes over.
//
// Because each bubble's cluster position is fixed before render (see
// CLUSTER_LAYOUTS), we don't need onLayout/measureInWindow to figure
// out the converge offset — it's simply -startX / -startY. This is a
// meaningful simplification vs the previous flex-grid implementation.

function WordBubble({
  word,
  startX,
  startY,
  inDelay,
  converging,
  convergeDelay,
}: {
  word: string;
  startX: number;
  startY: number;
  inDelay: number;
  converging: boolean;
  convergeDelay: number;
}) {
  // Stage 6.AspireBubbles: direct Animated.Value drivers for every
  // transform property. Industry-standard pattern from Wix
  // Engineering's "RN Animations Zero to Hero" and React Native's own
  // docs example for translateX-driven animation.
  //
  // Why direct Animated.Value instead of convergeProgress.interpolate:
  // RN issue #12453 (Native animation driver animates opacity to
  // wrong value) documents that newly-attached AnimatedInterpolation
  // nodes show a brief initialization "snap" on the native side
  // before settling to outputRange[0]. The interpolate node is
  // recreated on every React render because .interpolate(config)
  // builds a fresh derived node — useRef can't help here because
  // useRef only stabilizes the SOURCE Animated.Value, not the
  // derived interpolation. Every Phase 1 → Phase 2 prop change
  // (converging: false → true) re-renders WordBubble, recreates the
  // translateX/translateY interpolation nodes, and the new nodes
  // produce a 1-frame visible position snap.
  //
  // Direct Animated.Value driving translateX has no derived node:
  //   - Phase 1: translateX value = startX (set on construction),
  //     no animation running on it, value is exactly startX every
  //     frame, period.
  //   - Phase 2: Animated.timing(translateX, { toValue: 0 }) animates
  //     from current value (startX) to 0 smoothly. Same Animated.Value
  //     across renders thanks to useRef.
  //
  // The startX/startY props are captured in useRef's initializer, so
  // even though startX/startY can technically change between renders
  // (from positions useMemo recomputing), we lock to the FIRST values
  // we receive — consistent with the cluster being mounted-once.
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;
  const translateX = useRef(new Animated.Value(startX)).current;
  const translateY = useRef(new Animated.Value(startY)).current;

  // Phase 1: stagger-in. Only opacity + scale animate; translateX/Y
  // stay at their initial cluster positions.
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 380,
        delay: inDelay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // timing + Easing.back(1.5) replaces spring: lands EXACTLY at 1.0
      // (spring physics oscillate forever around the target which made
      // the converge handoff visibly jolt). back easing gives the
      // overshoot-and-settle feel of a sphere puffing up.
      Animated.timing(scale, {
        toValue: 1,
        duration: 480,
        delay: inDelay,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale, inDelay]);

  // Phase 2: converge. translateX/Y animate to 0 (screen center)
  // while scale shrinks to 0.15. All three share the same 500ms
  // timeline with quad-in easing — bubble accelerates into the burst
  // point. Opacity stays at 1; the bubble's small final size is
  // enough to feel like a collapse.
  useEffect(() => {
    if (!converging) return;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: 500,
        delay: convergeDelay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 500,
        delay: convergeDelay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.15,
        duration: 500,
        delay: convergeDelay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [converging, translateX, translateY, scale, convergeDelay]);

  const diameter = bubbleDiameter(word);
  const fontSize = bubbleFontSize(word);

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          // No interpolation — direct Animated.Value bindings.
          transform: [
            { translateX },
            { translateY },
            { scale },
          ],
          opacity,
        },
      ]}
    >
      <Text style={[styles.bubbleText, { fontSize }]} numberOfLines={1}>
        {word}
      </Text>
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
          That version of you is real.{'\n'}Not a fantasy. Not too much to ask for.{'\n'}It’s already in you, and we will help you manifest it.
        </Text>
      </Animated.View>
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
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
  bubble: {
    // Absolute layout so each bubble can be positioned by its
    // cluster offset transform. width/height/borderRadius are set
    // inline (dynamic per word length).
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(168,85,247,0.22)',
    borderWidth: 2,
    borderColor: 'rgba(192,132,252,0.7)',
    // Strong purple glow gives the sphere its luminous look. iOS
    // renders this as a soft outer halo; on Android it falls back
    // to elevation, which is fine for the cluster effect.
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 12,
  },
  bubbleText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    paddingHorizontal: 6,
    textShadowColor: 'rgba(192,132,252,0.95)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
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
