/**
 * FireworksBurst — a lightweight celebration: a few staggered bursts of
 * colored streaks radiating out, arcing down, fading. Pure reanimated, no
 * assets, plays once on mount. Rendered absolutely over the top area of a
 * screen (pointerEvents none — decoration never blocks taps).
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const COLORS = ['#F7CE46', '#F0885C', '#7BC5C0', '#8B7FD9', '#E58A7E', '#7BB86A'];
const PARTICLES_PER_BURST = 12;

type ParticleSpec = {
  cx: number; // burst center, fraction of width
  cy: number; // fraction of height (of the overlay box)
  angle: number;
  distance: number;
  color: string;
  size: number;
  delay: number;
};

function Particle({ spec, boxW, boxH }: { spec: ParticleSpec; boxW: number; boxH: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(spec.delay, withTiming(1, { duration: 950, easing: Easing.out(Easing.quad) }));
  }, [t, spec.delay]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const gravity = 60 * p * p; // arc downward as the streak dies
    return {
      opacity: p === 0 ? 0 : 1 - p,
      transform: [
        { translateX: Math.cos(spec.angle) * spec.distance * p },
        { translateY: Math.sin(spec.angle) * spec.distance * p + gravity },
        { rotate: `${spec.angle}rad` },
        { scale: 1 - 0.4 * p },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: spec.cx * boxW,
          top: spec.cy * boxH,
          width: spec.size,
          height: spec.size * 0.38,
          borderRadius: spec.size,
          backgroundColor: spec.color,
        },
        style,
      ]}
    />
  );
}

export function FireworksBurst({ height = 260 }: { height?: number }) {
  const { width } = useWindowDimensions();

  // Random once per mount — a celebration may vary, replays don't need to.
  const specs = useMemo<ParticleSpec[]>(() => {
    const bursts = [
      { cx: 0.5, cy: 0.30, delay: 0 },
      { cx: 0.22, cy: 0.55, delay: 260 },
      { cx: 0.78, cy: 0.50, delay: 480 },
    ];
    const out: ParticleSpec[] = [];
    for (const b of bursts) {
      for (let i = 0; i < PARTICLES_PER_BURST; i++) {
        const jitter = (Math.random() - 0.5) * 0.5;
        out.push({
          cx: b.cx,
          cy: b.cy,
          angle: (i / PARTICLES_PER_BURST) * Math.PI * 2 + jitter,
          distance: 55 + Math.random() * 60,
          color: COLORS[(i + Math.floor(Math.random() * COLORS.length)) % COLORS.length],
          size: 12 + Math.random() * 8,
          delay: b.delay + Math.random() * 80,
        });
      }
    }
    return out;
  }, []);

  return (
    <View style={[styles.box, { height }]} pointerEvents="none">
      {specs.map((spec, i) => (
        <Particle key={i} spec={spec} boxW={width} boxH={height} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  particle: { position: 'absolute' },
});
