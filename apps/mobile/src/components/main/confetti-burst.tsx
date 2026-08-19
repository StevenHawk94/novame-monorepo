/**
 * Full-screen confetti celebration (~3s): small colored pieces launch from
 * the upper third, tumble down with drift and spin, fade near the floor,
 * then onDone fires so the parent can unmount. Brand palette, pointerEvents
 * none — it never blocks the tap that triggered it.
 */
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const COLORS = ['#F2A03D', '#7BB661', '#D9694E', '#F2C14E', '#8A6240', '#FFF6E8', '#6BA3D6'];
const PIECES = 26;
const DURATION = 2600;
const MAX_DELAY = 350;

type PieceSpec = {
  x: number;
  delay: number;
  fall: number;
  drift: number;
  spin: number;
  size: number;
  color: string;
  round: boolean;
};

function Piece({ spec, onLast }: { spec: PieceSpec; onLast?: () => void }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      spec.delay,
      withTiming(1, { duration: DURATION, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished && onLast) runOnJS(onLast)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: spec.x + spec.drift * t.value },
      { translateY: -40 + spec.fall * t.value },
      { rotate: `${spec.spin * t.value}deg` },
    ],
    opacity: t.value < 0.75 ? 1 : 1 - (t.value - 0.75) / 0.25,
  }));

  return (
    <Animated.View
      style={[
        styles.piece,
        {
          width: spec.size,
          height: spec.round ? spec.size : spec.size * 0.55,
          borderRadius: spec.round ? spec.size / 2 : 2,
          backgroundColor: spec.color,
        },
        style,
      ]}
    />
  );
}

export function ConfettiBurst({ onDone }: { onDone?: () => void }) {
  const { width, height } = useWindowDimensions();

  const pieces = useMemo<PieceSpec[]>(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        x: Math.random() * width,
        delay: Math.random() * MAX_DELAY,
        fall: height * (0.55 + Math.random() * 0.45),
        drift: (Math.random() - 0.5) * 140,
        spin: (Math.random() - 0.5) * 720,
        size: 8 + Math.random() * 8,
        color: COLORS[i % COLORS.length],
        round: Math.random() < 0.3,
      })),
    [width, height],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((spec, i) => (
        <Piece key={i} spec={spec} onLast={i === pieces.length - 1 ? onDone : undefined} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', top: 0, left: 0 },
});
