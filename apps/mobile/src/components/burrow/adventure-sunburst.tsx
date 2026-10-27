import { memo, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Group, Picture, vec } from '@shopify/react-native-skia';
import Animated, { cancelAnimation, Easing, runOnUI, useAnimatedStyle, useDerivedValue, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import { ADVENTURE_REWARD_MOTION as M, adventureSunburstRadius, rewardSunburstOpacity } from '@/lib/adventure-reward-motion';
import { adventureSunburstScene, warmAdventureSunburst } from '@/lib/adventure-sunburst-scene';

/** One viewport-sized canvas, not a giant rotating bitmap. Static ray geometry
 * is reused; Reanimated changes only rotation and native view opacity. */
export const AdventureSunburst = memo(function AdventureSunburst({ width, height, centerX, centerY, progress, active, reduced }: {
  width: number; height: number; centerX: number; centerY: number;
  progress: SharedValue<number>; active: boolean; reduced: boolean;
}) {
  const angle = useSharedValue(0);
  const radius = adventureSunburstRadius(width, height, centerY);
  const picture = useMemo(() => adventureSunburstScene(centerX, centerY, radius), [centerX, centerY, radius]);
  useEffect(() => { runOnUI(warmAdventureSunburst)(picture, centerX, centerY, radius); }, [picture, centerX, centerY, radius]);
  useEffect(() => {
    if (active && !reduced) angle.value = withRepeat(withTiming(angle.value + Math.PI * 2, { duration: M.rotation, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(angle);
  }, [active, reduced, angle]);
  const transform = useDerivedValue(() => [{ rotate: angle.value }]);
  // Recorded pictures own their paints, so Group's inherited paint opacity
  // cannot fade them. Use native compositing, without an extra Skia saveLayer.
  const opacity = useAnimatedStyle(() => ({ opacity: rewardSunburstOpacity(progress.value) }));
  return <Animated.View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFillObject, opacity]}><Canvas style={StyleSheet.absoluteFillObject}>
    <Group origin={vec(centerX, centerY)} transform={transform}>
      <Picture picture={picture}/>
    </Group>
  </Canvas></Animated.View>;
});
