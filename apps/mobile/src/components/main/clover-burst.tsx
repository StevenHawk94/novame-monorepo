/**
 * Floating Clover reward toast. Mounts, pops in, drifts upward, fades out
 * (~1.6s), then calls onDone so the parent can unmount it. Every currency
 * award in the app uses this one component so the reward language stays
 * uniform (user directive: all rewards read as clovers, with a small
 * appear-then-vanish animation).
 */
import { useEffect } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ICONS } from '@/lib/icons';

type Props = {
  amount: number;
  /** Optional total lifetime. Omitted preserves the original ~1.45s timing. */
  durationMs?: number;
  /** Called after the animation finishes — unmount from the parent. */
  onDone?: () => void;
};

export function CloverBurst({ amount, durationMs, onDone }: Props) {
  const progress = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    const enterMs = 220;
    const exitMs = 480;
    const holdMs = durationMs === undefined
      ? 750
      : Math.max(0, durationMs - enterMs - exitMs);
    progress.value = withTiming(1, {
      duration: durationMs ?? 1500,
      easing: Easing.out(Easing.quad),
    });
    fade.value = withSequence(
      withTiming(1, { duration: enterMs, easing: Easing.out(Easing.back(1.5)) }),
      withDelay(
        holdMs,
        withTiming(0, { duration: exitMs }, (finished) => {
          if (finished && onDone) runOnJS(onDone)();
        }),
      ),
    );
  }, [progress, fade, durationMs, onDone]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateY: -34 * progress.value },
      { scale: 0.7 + 0.3 * fade.value },
    ],
  }));

  if (amount <= 0) return null;
  return (
    <Animated.View style={[styles.wrap, style]} pointerEvents="none">
      <View style={styles.content}>
        <Text style={styles.text}>+{amount}</Text>
        <ExpoImage source={ICONS.Clovers} style={styles.icon} contentFit="contain" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#2B2B2B',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  text: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#2E7A3A' },
  icon: { width: 27, height: 27 },
});
