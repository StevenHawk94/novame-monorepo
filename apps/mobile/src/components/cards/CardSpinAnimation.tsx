/**
 * CardSpinAnimation — Stage 3.8.3 real implementation
 *
 * Spinning card with continuous Y-axis 3D rotation, used during
 * publishing/analyzing phase of record flow and onboarding step-spinning.
 *
 * Visual model (1:1 with old Capacitor CardSpinAnimation.js):
 *   - 67x100 card (matches keyword card AR 2:3, scaled down)
 *   - Y-axis flip 1.4s linear infinite loop
 *   - Purple glow pulse on the card frame, 2s ease-in-out infinite
 *   - 3 purple dots below card, dotBounce stagger 0.2s offset
 *   - Optional labels: label1 / label2 / sublabel
 *
 * Two lifecycle modes (preserves stub contract for backward-compat):
 *   - 'timed': spin for `duration` ms then call `onDone`. Used by
 *     onboarding step-spinning where the spin is fixed-length.
 *   - 'continuous': spin forever, parent unmounts to stop. Used by
 *     record.tsx publishing/analyzing where spin lasts until
 *     network response arrives.
 *
 * Bundle assets (no R2):
 *   - assets/images/home/analyze.webp  (front)
 *   - assets/images/home/analyze-back.webp (back)
 */
import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from 'react-native-reanimated';

const CARD_W = 67;
const CARD_H = Math.round(CARD_W / (1024 / 1536)); // ≈ 100, matches AR 2:3

const FRONT_IMG = require('../../../assets/images/home/analyze.webp');
const BACK_IMG = require('../../../assets/images/home/analyze-back.webp');

export type CardSpinAnimationProps = {
  /** Headline shown above the spinner. */
  label1: string;
  /** Optional middle line (used by record publishing phase). */
  label2?: string;
  /** Smaller text below the headline. */
  sublabel: string;
  /**
   * Spin lifecycle mode. See file header.
   *   - 'timed' (default): runs `duration` ms then calls `onDone`
   *   - 'continuous': spins forever; parent unmount = stop
   */
  mode?: 'timed' | 'continuous';
  /** Required only for mode='timed'. */
  duration?: number;
  /** Required only for mode='timed'. */
  onDone?: () => void;
};

export function CardSpinAnimation({
  label1,
  label2,
  sublabel,
  mode = 'timed',
  duration,
  onDone,
}: CardSpinAnimationProps) {
  // Y-axis rotation, infinite loop while mounted.
  const rotation = useSharedValue(0);
  // Glow opacity pulse, 2s cycle.
  const glow = useSharedValue(0.45);
  // 3 dots bounce — independent shared values for stagger.
  const dot0 = useSharedValue(0);
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);

  useEffect(() => {
    // Continuous Y rotation: 0 -> 360 in 1.4s, infinite.
    rotation.value = withRepeat(
      withTiming(360, { duration: 1400, easing: Easing.linear }),
      -1,
      false,
    );

    // Glow pulse: oscillate 0.45 <-> 0.65 every 2s, infinite.
    // Use withRepeat reversed (true) for ping-pong.
    glow.value = withRepeat(
      withTiming(0.65, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );

    // 3 dots bounce: each translates -6px every 1.2s, staggered 0.2s.
    // Reversed=true for ping-pong.
    dot0.value = withRepeat(
      withTiming(-6, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    setTimeout(() => {
      dot1.value = withRepeat(
        withTiming(-6, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }, 200);
    setTimeout(() => {
      dot2.value = withRepeat(
        withTiming(-6, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }, 400);

    return () => {
      cancelAnimation(rotation);
      cancelAnimation(glow);
      cancelAnimation(dot0);
      cancelAnimation(dot1);
      cancelAnimation(dot2);
    };
  }, [rotation, glow, dot0, dot1, dot2]);

  // Timed-mode: schedule onDone after duration ms.
  useEffect(() => {
    if (mode !== 'timed') return;
    if (typeof duration !== 'number' || !onDone) return;
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [mode, duration, onDone]);

  // Card front + back animated styles.
  // Front: rotates 0 -> 360. Back: rotates 180 -> 540 (always 180deg ahead).
  // backfaceVisibility 'hidden' lets each face hide naturally on rotation.
  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 400 },
      { rotateY: `${rotation.value}deg` },
    ],
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 400 },
      { rotateY: `${rotation.value + 180}deg` },
    ],
  }));

  // Glow style — pulses opacity and radius.
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
  }));

  const dot0Style = useAnimatedStyle(() => ({
    transform: [{ translateY: dot0.value }],
    opacity: 0.4 + Math.abs(dot0.value) / 6 * 0.6,
  }));
  const dot1Style = useAnimatedStyle(() => ({
    transform: [{ translateY: dot1.value }],
    opacity: 0.4 + Math.abs(dot1.value) / 6 * 0.6,
  }));
  const dot2Style = useAnimatedStyle(() => ({
    transform: [{ translateY: dot2.value }],
    opacity: 0.4 + Math.abs(dot2.value) / 6 * 0.6,
  }));

  return (
    <View style={styles.root}>
      {/* Card with glow */}
      <View style={styles.cardWrap}>
        <Animated.View style={[styles.glow, glowStyle]} />
        <Animated.View style={[styles.face, frontStyle]}>
          <Image source={FRONT_IMG} style={styles.faceImage} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[styles.face, backStyle]}>
          <Image source={BACK_IMG} style={styles.faceImage} resizeMode="contain" />
        </Animated.View>
      </View>

      {/* Labels */}
      <Text style={styles.label1}>{label1}</Text>
      {label2 ? <Text style={styles.label2}>{label2}</Text> : null}
      <Text style={styles.sublabel}>{sublabel}</Text>

      {/* 3 dots */}
      <View style={styles.dots}>
        <Animated.View style={[styles.dot, dot0Style]} />
        <Animated.View style={[styles.dot, dot1Style]} />
        <Animated.View style={[styles.dot, dot2Style]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  cardWrap: {
    width: CARD_W,
    height: CARD_H,
    marginBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: CARD_W + 6,
    height: CARD_H + 6,
    borderRadius: 6,
    shadowColor: '#A855F7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 18,
  },
  face: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: 4,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    backgroundColor: '#1a1020',
  },
  faceImage: {
    width: '100%',
    height: '100%',
  },
  label1: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    fontWeight: '700',
    textAlign: 'center',
  },
  label2: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
  },
  sublabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#A855F7',
  },
});
