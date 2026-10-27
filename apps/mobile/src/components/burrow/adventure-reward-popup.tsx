import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {AppModal as Modal} from '@/components/layout/app-modal';
import Animated, { cancelAnimation, Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BURROW_MOTION } from '@/lib/burrow-motion';

/** Native Modal owns input/accessibility; UI-thread motion owns its only transition. */
export function AdventureRewardPopup({ visible, closing, onClosed, children }: {
  visible: boolean; closing: boolean; onClosed: () => void; children: ReactNode;
}) {
  const progress = useSharedValue(0), closed = useRef(onClosed); closed.current = onClosed;
  useEffect(() => {
    const finish = () => closed.current();
    if (!visible) { progress.value = 0; return; }
    progress.value = withTiming(closing ? 0 : 1, { duration: closing ? BURROW_MOTION.dismiss : BURROW_MOTION.popup,
      easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }, finished => {
      if (finished && closing) runOnJS(finish)();
    });
    return () => cancelAnimation(progress);
  }, [visible, closing, progress]);
  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panel = useAnimatedStyle(() => ({ opacity: progress.value,
    transform: [{ translateY: 24 * (1 - progress.value) }, { scale: .92 + progress.value * .08 }] }));
  return <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent
    onRequestClose={() => {}}>
    <View style={s.root} accessibilityViewIsModal>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, s.scrim, scrim]}/>
      <Animated.View style={[s.panel, panel]}>{children}</Animated.View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({ root: { flex: 1, justifyContent: 'center', padding: 28 },
  scrim: { backgroundColor: '#00000088' }, panel: { width: '100%' } });
