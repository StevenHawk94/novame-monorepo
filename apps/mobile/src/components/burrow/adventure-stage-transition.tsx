import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import Animated, { Easing, ReduceMotion, withTiming } from 'react-native-reanimated';
import { BURROW_MOTION } from '@/lib/burrow-motion';

/** Page children must own their opaque background and header inside this layer.
 * Exiting retains the old native drawing, not a second live React page.
 * Compact is only for content inside an already-opaque dialogue panel. */
export function AdventureStageTransition({ stageKey, children, direction = 'forward', compact = false, nativePage = false }: {
  stageKey: string; children: ReactNode; direction?: 'forward' | 'back'; compact?: boolean; nativePage?:boolean;
}) {
  const { width } = useWindowDimensions();
  const appeared = useRef(false);
  const layer = useRef({ key: stageKey, order: 0 });
  // Native exiting drawings can outlive their React sibling. Explicit ordering
  // keeps the incoming opaque page above them, regardless of removal order.
  if (layer.current.key !== stageKey) layer.current = { key: stageKey, order: layer.current.order + 1 };
  useEffect(() => { appeared.current = true; }, []);
  // A catalogue only pushes native child routes; it never changes internal
  // stages. Registering a static Reanimated exit here retains its entire list
  // drawing for another 300ms when the native stack already owns the exit.
  if(nativePage)return <View style={s.viewport} collapsable={false}>
    <View style={StyleSheet.absoluteFillObject} collapsable={false}>{children}</View>
  </View>;
  const sign = direction === 'back' ? -1 : 1;
  const distance = compact ? 16 : width;
  const duration = compact ? BURROW_MOTION.dialogue : BURROW_MOTION.page;
  const enter = () => {
    'worklet';
    return { initialValues: { opacity: compact ? 0 : 1, transform: [{ translateX: sign * distance }] },
      animations: { opacity: withTiming(1, { duration, reduceMotion: ReduceMotion.System }),
        transform: [{ translateX: withTiming(0, { duration, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }) }] } };
  };
  const exit = () => {
    'worklet';
    return { initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
      animations: { opacity: withTiming(compact ? 0 : 1, { duration, reduceMotion: ReduceMotion.System }),
        transform: [{ translateX: withTiming(compact ? -sign * 8 : 0, { duration,
          easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }) }] } };
  };
  return <View style={s.viewport} collapsable={false}>
    <Animated.View key={stageKey} collapsable={false} entering={appeared.current ? enter : undefined}
      exiting={exit} style={[StyleSheet.absoluteFillObject, { zIndex: layer.current.order }]}>{children}</Animated.View>
  </View>;
}
const s = StyleSheet.create({ viewport: { flex: 1, overflow: 'hidden' } });
