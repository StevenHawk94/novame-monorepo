import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/** Keep the same native bar across milestones; only its left-anchored scale changes. */
export function QuestProgress({ progress, target }: { progress: number; target: number }) {
  const fraction = Number.isFinite(progress) && Number.isFinite(target)
    ? Math.min(1, Math.max(0, progress / Math.max(1, target))) : 0;
  const previous = useRef(fraction);
  const shown = useSharedValue(fraction);
  useEffect(() => {
    if (previous.current === fraction) return;
    previous.current = fraction;
    shown.value = withTiming(fraction, { duration: 600, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System });
  }, [fraction, shown]);
  useEffect(() => () => cancelAnimation(shown), [shown]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scaleX: shown.value }] }));
  return <View accessibilityRole="progressbar" accessibilityLabel="Quest progress"
    accessibilityValue={{ min: 0, max: Math.max(1, target), now: Math.min(Math.max(0, progress), Math.max(1, target)) }} style={styles.track}>
    <Animated.View style={[styles.fill, animated]} />
  </View>;
}

const styles = StyleSheet.create({
  track: { marginTop: 5, height: 7, borderRadius: 4, backgroundColor: '#E8E5DC', overflow: 'hidden' },
  fill: { width: '100%', height: '100%', backgroundColor: '#CF744C', transformOrigin: 'left center', borderRadius: 4 },
});
