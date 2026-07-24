/**
 * ConfettiBurst — the Voidpet-style celebration (2026-07-24): a shower of
 * paper confetti launched from the top of the screen, tumbling down with
 * per-piece spin, drift and fade. Pure reanimated on the UI thread (no
 * assets, no JS-frame work after mount), plays once. Deterministic pseudo-
 * random per index so renders are stable. pointerEvents none — decoration
 * never blocks taps. Layer it with FireworksBurst on result screens.
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

const COLORS = ['#F7CE46', '#F0885C', '#7BC5C0', '#8B7FD9', '#E58A7E', '#7BB86A', '#F9A8C9', '#6BA3D6'];
const PIECES = 36;
const FALL_MS = 2400;

/** Deterministic 0..1 from an index (renders never reshuffle). */
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

type PieceSpec = {
  x0: number; // start x, fraction of width
  drift: number; // horizontal drift px over the fall
  fall: number; // total fall px
  spin: number; // total rotation deg
  tilt: number; // 3D-ish flip speed (scaleY oscillation phase)
  size: number;
  color: string;
  delay: number;
};

function Piece({ spec, boxW }: { spec: PieceSpec; boxW: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      spec.delay,
      withTiming(1, { duration: FALL_MS, easing: Easing.in(Easing.quad) }),
    );
  }, [t, spec.delay]);

  const style = useAnimatedStyle(() => {
    const p = t.value;
    // Flutter: scaleX oscillates so the paper appears to flip as it falls.
    const flip = Math.cos(p * spec.tilt * Math.PI * 2);
    return {
      opacity: p < 0.75 ? 1 : Math.max(0, 1 - (p - 0.75) / 0.25),
      transform: [
        { translateX: Math.sin(p * Math.PI * 2) * 14 + spec.drift * p },
        { translateY: spec.fall * p },
        { rotate: `${spec.spin * p}deg` },
        { scaleX: 0.35 + 0.65 * Math.abs(flip) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: spec.x0 * boxW,
          width: spec.size,
          height: spec.size * 0.62,
          backgroundColor: spec.color,
          borderRadius: spec.size * 0.18,
        },
        style,
      ]}
    />
  );
}

export function ConfettiBurst() {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo<PieceSpec[]>(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        x0: rand(i, 1),
        drift: (rand(i, 2) - 0.5) * 120,
        fall: height * (0.55 + 0.45 * rand(i, 3)),
        spin: (rand(i, 4) - 0.5) * 1080,
        tilt: 1.5 + rand(i, 5) * 2.5,
        size: 8 + rand(i, 6) * 8,
        color: COLORS[i % COLORS.length],
        delay: Math.round(rand(i, 7) * 350),
      })),
    [height],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((spec, i) => (
        <Piece key={i} spec={spec} boxW={width} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', top: -20 },
});
