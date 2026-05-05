/**
 * Confetti — Stage 3.8.4 real implementation
 *
 * Fullscreen particle burst — 48 colored squares/circles fall from top
 * with random spin, fading out as they reach bottom.
 *
 * Visual model (1:1 with old Capacitor Confetti.js):
 *   - 48 particles, 8 color cycle
 *   - Drop from y=-12px to bottom of screen + 50px
 *   - Random shape: 50% circle (50% radius) / 50% square (2px radius)
 *   - Random size 4-13px
 *   - Random fall duration 1.4-2.6s (ease-in)
 *   - Random delay 0-0.6s
 *   - Random rotation 720deg or -540deg
 *   - Opacity 1 -> 0 over fall
 *   - pointerEvents none (decoration only)
 *   - zIndex 9999 (top of stack)
 *
 * Lifecycle: mount = burst starts. After ~3s all particles have faded.
 * Parent decides when to unmount (typically setTimeout 3000ms).
 *
 * Performance: 48 particles each with 2 sharedValues (translateY + rotate)
 * = 96 sharedValues total. Reanimated v4 handles this on UI thread
 * without blocking JS thread.
 */
import { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const COLORS = [
  '#A855F7',
  '#7C3AED',
  '#F59E0B',
  '#10B981',
  '#EF4444',
  '#3B82F6',
  '#EC4899',
  '#FBBF24',
];

const PARTICLE_COUNT = 48;

type ParticleConfig = {
  id: number;
  color: string;
  leftPercent: number;
  delayMs: number;
  size: number;
  durationMs: number;
  isCircle: boolean;
  rotateDeg: number;
};

function makeParticles(): ParticleConfig[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    color: COLORS[i % COLORS.length],
    // Spread across screen width with slight random jitter.
    leftPercent: (i / PARTICLE_COUNT) * 100 + Math.random() * 8,
    delayMs: Math.random() * 600,
    size: Math.random() * 9 + 4,
    durationMs: Math.random() * 1200 + 1400,
    isCircle: Math.random() > 0.5,
    rotateDeg: Math.random() > 0.5 ? 720 : -540,
  }));
}

function ConfettiParticle({ config }: { config: ParticleConfig }) {
  const screenH = Dimensions.get('window').height;
  const translateY = useSharedValue(-12);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const startTimer = setTimeout(() => {
      // Fade in instantly then start falling.
      opacity.value = 1;
      translateY.value = withTiming(screenH + 50, {
        duration: config.durationMs,
        easing: Easing.in(Easing.quad),
      });
      rotate.value = withTiming(config.rotateDeg, {
        duration: config.durationMs,
        easing: Easing.linear,
      });
      // Fade out near end of fall.
      opacity.value = withTiming(0, {
        duration: config.durationMs,
        easing: Easing.in(Easing.cubic),
      });
    }, config.delayMs);

    return () => clearTimeout(startTimer);
  }, [config, screenH, translateY, rotate, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: -12,
          left: `${config.leftPercent}%`,
          width: config.size,
          height: config.size,
          backgroundColor: config.color,
          borderRadius: config.isCircle ? config.size / 2 : 2,
        },
        animStyle,
      ]}
    />
  );
}

/**
 * Renders a one-shot confetti burst. Mount to start, unmount to clean up.
 * Parent should setTimeout(unmount, 3000) for the canonical experience.
 */
export function Confetti() {
  const particles = useMemo(makeParticles, []);

  return (
    <View pointerEvents="none" style={styles.root}>
      {particles.map((p) => (
        <ConfettiParticle key={p.id} config={p} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    zIndex: 9999,
    elevation: 9999,
  },
});
