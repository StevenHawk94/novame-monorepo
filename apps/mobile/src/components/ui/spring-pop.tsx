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
  withSpring,
  withTiming,
} from 'react-native-reanimated';

type Props = {
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function SpringPop({ delay = 0, style, children }: Props) {
  const scale = useSharedValue(0.3);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withDelay(delay, withSpring(1, { damping: 11, stiffness: 170, mass: 0.8 }));
    opacity.value = withDelay(delay, withTiming(1, { duration: 180 }));
  }, [scale, opacity, delay]);

  const anim = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}
