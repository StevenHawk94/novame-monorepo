/**
 * Reflect completion firework: one bright rocket rises from the lower middle,
 * flashes at the centre, then a dense cloud of paper pieces bursts outward
 * and falls under gravity. Pure Reanimated; pointer events always pass through.
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

const COLORS = [
  '#F7CE46', '#F0885C', '#7BC5C0', '#8B7FD9', '#E58A7E',
  '#7BB86A', '#F9A8C9', '#6BA3D6', '#FFF6E8', '#ECA6D4',
];
const PIECES = 88;
const ROCKET_MS = 680;
const BURST_DELAY_MS = 620;
const FALL_MS = 2500;

/** Deterministic 0..1 from an index so rerenders never reshuffle the burst. */
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

type PieceSpec = {
  vx: number;
  vy: number;
  gravity: number;
  spin: number;
  tilt: number;
  size: number;
  color: string;
  delay: number;
  round: boolean;
};

function Rocket({ height }: { height: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: ROCKET_MS, easing: Easing.out(Easing.cubic) });
  }, [t]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.82 ? 1 : Math.max(0, 1 - (t.value - 0.82) / 0.18),
    transform: [
      { translateY: -height * 0.43 * t.value },
      { scaleY: 0.8 + t.value * 1.3 },
    ],
  }));

  return <Animated.View style={[styles.rocket, { top: height * 0.88 }, style]} />;
}

function BurstFlash({ originY }: { originY: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      BURST_DELAY_MS - 40,
      withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) }),
    );
  }, [t]);

  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : Math.max(0, 1 - t.value),
    transform: [{ scale: 0.15 + t.value * 4.2 }],
  }));

  return <Animated.View style={[styles.flash, { top: originY - 12 }, style]} />;
}

function Piece({ spec, originX, originY }: { spec: PieceSpec; originX: number; originY: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      BURST_DELAY_MS + spec.delay,
      withTiming(1, { duration: FALL_MS, easing: Easing.linear }),
    );
  }, [t, spec.delay]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const flip = Math.cos(p * spec.tilt * Math.PI * 2);
    return {
      opacity: p === 0 ? 0 : p < 0.86 ? 1 : Math.max(0, 1 - (p - 0.86) / 0.14),
      transform: [
        { translateX: spec.vx * p + Math.sin(p * Math.PI * 4) * 8 },
        { translateY: spec.vy * p + spec.gravity * p * p },
        { rotate: `${spec.spin * p}deg` },
        { scaleX: 0.3 + 0.7 * Math.abs(flip) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: originX - spec.size / 2,
          top: originY - spec.size / 2,
          width: spec.size,
          height: spec.round ? spec.size : spec.size * 0.58,
          borderRadius: spec.round ? spec.size / 2 : 2,
          backgroundColor: spec.color,
        },
        style,
      ]}
    />
  );
}

export function ConfettiBurst() {
  const { width, height } = useWindowDimensions();
  const originX = width / 2;
  const originY = height * 0.45;
  const pieces = useMemo<PieceSpec[]>(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        const angle = rand(i, 1) * Math.PI * 2;
        const horizontal = width * (0.20 + rand(i, 2) * 0.25);
        const vertical = height * (0.12 + rand(i, 3) * 0.14);
        return {
          vx: Math.cos(angle) * horizontal,
          // Initial outward lift; gravity turns every piece into a visible fall.
          vy: Math.sin(angle) * vertical - height * (0.12 + rand(i, 4) * 0.08),
          gravity: height * (0.42 + rand(i, 5) * 0.16),
          spin: (rand(i, 6) - 0.5) * 1440,
          tilt: 1.5 + rand(i, 7) * 3,
          size: 7 + rand(i, 8) * 8,
          color: COLORS[i % COLORS.length],
          delay: Math.round(rand(i, 9) * 150),
          round: rand(i, 10) < 0.22,
        };
      }),
    [height, width],
  );

  return (
    <View pointerEvents="none" style={styles.box}>
      <Rocket height={height} />
      <BurstFlash originY={originY} />
      {pieces.map((spec, i) => (
        <Piece key={i} spec={spec} originX={originX} originY={originY} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { ...StyleSheet.absoluteFillObject, zIndex: 10, overflow: 'hidden' },
  rocket: {
    position: 'absolute', left: '50%', marginLeft: -3, width: 6, height: 24,
    borderRadius: 4, backgroundColor: '#FFF6E8',
    shadowColor: '#F7CE46', shadowOpacity: 0.9, shadowRadius: 8,
  },
  flash: {
    position: 'absolute', left: '50%', marginLeft: -12, width: 24, height: 24,
    borderRadius: 12, backgroundColor: '#FFF6E8',
  },
  piece: { position: 'absolute' },
});
