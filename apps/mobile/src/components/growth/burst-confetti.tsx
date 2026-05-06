/**
 * BurstConfetti — Stage 3.9.A.2.3
 *
 * Short, explosive particle burst designed for inline use inside a
 * task row. Particles emit from the center of the parent container
 * and radiate outward in all directions, then fade. Duration 1s.
 *
 * Usage: mount on task complete, parent removes after 1000ms.
 *
 * Independent from cards/Confetti.tsx — that one is a top-down shower
 * for big moments (publish insight). This one is a tight pop.
 */
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

const PARTICLE_COUNT = 18;
const COLORS = ['#F5641F', '#A855F7', '#F5B042', '#22C55E', '#EC4899', '#FFFFFF'];

type ParticleConfig = {
  id: number;
  angle: number;       // radians
  distance: number;    // px from center
  size: number;
  color: string;
  delay: number;       // small per-particle stagger so the burst breathes
  rotateEnd: number;   // degrees of rotation across the lifetime
};

function makeParticles(): ParticleConfig[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    // Even angular spread + small jitter so it looks organic, not clocklike.
    const baseAngle = (i / PARTICLE_COUNT) * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 0.4;
    return {
      id: i,
      angle: baseAngle + jitter,
      distance: 60 + Math.random() * 50, // 60..110 px outward
      size: 6 + Math.random() * 5,        // 6..11 px squares
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      delay: Math.random() * 60,
      rotateEnd: (Math.random() - 0.5) * 540,
    };
  });
}

function Particle({ config }: { config: ParticleConfig }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withTiming(1, {
      duration: 900,
      easing: Easing.out(Easing.cubic),
    });
  }, [t]);

  const style = useAnimatedStyle(() => {
    const dx = Math.cos(config.angle) * config.distance * t.value;
    // Negative dy so positive distance moves up + outward (RN y is down).
    const dy = Math.sin(config.angle) * config.distance * t.value;
    // Opacity holds at full for the first 60% then fades.
    const opacity = t.value < 0.6 ? 1 : 1 - (t.value - 0.6) / 0.4;
    return {
      transform: [
        { translateX: dx },
        { translateY: dy },
        { rotate: `${config.rotateEnd * t.value}deg` },
      ],
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          width: config.size,
          height: config.size,
          backgroundColor: config.color,
        },
        style,
      ]}
    />
  );
}

export function BurstConfetti() {
  const particles = useMemo(makeParticles, []);
  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={styles.center}>
        {particles.map((p) => (
          <Particle key={p.id} config={p} />
        ))}
      </View>
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
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  center: {
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    borderRadius: 2,
  },
});
