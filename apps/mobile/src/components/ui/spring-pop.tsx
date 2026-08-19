/**
 * SpringPop — mounts its children small and springs them to full size
 * (user directive: every reward/info box pops in from small to large with a
 * bouncy spring). Optional delay staggers a column of cards.
 */
import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  delay?: number;
  clampOvershoot?: boolean;
  boundedBounce?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function SpringPop({
  delay = 0,
  clampOvershoot = false,
  boundedBounce = false,
  style,
  children,
}: Props) {
  const scale = useSharedValue(boundedBounce ? 0 : 0.3);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withDelay(
      delay,
      boundedBounce
        ? withSequence(
            withTiming(1, { duration: 210 }),
            withTiming(0.9, { duration: 100 }),
            withTiming(1, { duration: 140 }),
          )
        : withSpring(1, {
            damping: 11, stiffness: 170, mass: 0.8, overshootClamping: clampOvershoot,
          }),
    );
    opacity.value = withDelay(delay, withTiming(1, { duration: 180 }));
  }, [scale, opacity, delay, clampOvershoot, boundedBounce]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
