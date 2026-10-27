import { memo, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

const COLORS = ['#F8C957', '#F28B70', '#94B69E', '#FFF1C7', '#B8A5D1'];
const DURATION = 850;
const Piece = memo(function Piece({ index, progress }: { index: number; progress: SharedValue<number> }) {
  const angle = index * 2.39996, distance = 28 + index % 5 * 8;
  const style = useAnimatedStyle(() => {
    const t = progress.value, travel = 1 - (1 - t) ** 3;
    return { opacity: t === 0 ? 0 : Math.min(1, t * 14) * Math.max(0, Math.min(1, (1 - t) / .35)),
      transform: [{ translateX: Math.cos(angle) * distance * travel },
        { translateY: Math.sin(angle) * distance * travel - 15 * travel + 36 * t * t },
        { rotate: `${index * 29 + t * 150}deg` }, { scale: .7 + Math.sin(t * Math.PI) * .3 }] };
  });
  return <Animated.View style={[styles.piece, { backgroundColor: COLORS[index % COLORS.length],
    width: index % 3 ? 4 : 6, height: index % 3 ? 8 : 5 }, style]} />;
});

/** A short card-local flourish. One UI-thread clock; never owns input or money. */
export function QuestClaimConfetti({ onComplete }: { onComplete: () => void }) {
  const progress = useSharedValue(0), reduced = useReducedMotion();
  const complete = useRef(onComplete); complete.current = onComplete;
  useEffect(() => {
    if (reduced) { complete.current(); return; }
    let active = true;
    const finish = () => { if (active) complete.current(); };
    progress.value = withTiming(1, { duration: DURATION, easing: Easing.linear }, finished => {
      if (finished) runOnJS(finish)();
    });
    return () => { active = false; cancelAnimation(progress); };
  }, [progress, reduced]);
  if (reduced) return null;
  return <View pointerEvents="none" accessible={false} style={styles.burst}>
    {Array.from({ length: 12 }, (_, index) => <Piece key={index} index={index} progress={progress} />)}
  </View>;
}

const styles = StyleSheet.create({
  burst: { position: 'absolute', right: 48, top: '50%', width: 0, height: 0, zIndex: 2 },
  piece: { position: 'absolute', left: -2, top: -4, borderRadius: 1.5 },
});
