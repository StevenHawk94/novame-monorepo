import { useEffect, useRef } from 'react';
import { AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/ui/feedback-pressable';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

const COLORS = ['#E9AD48', '#F17E67', '#79B99A', '#F4D777', '#CE91B9', '#86BED1'];

function ConfettiPiece({ index }: { index: number }) {
  const progress = useSharedValue(0);
  useEffect(() => { progress.value = withTiming(1, { duration: 700 + index % 5 * 50, easing: Easing.out(Easing.cubic) }); }, [progress, index]);
  const angle = index * 2.39996;
  const distance = 92 + index % 7 * 15;
  const style = useAnimatedStyle(() => ({
    opacity: progress.value < .7 ? 1 : Math.max(0, (1 - progress.value) / .3),
    transform: [
      { translateX: Math.cos(angle) * distance * progress.value },
      { translateY: Math.sin(angle) * distance * progress.value + 44 * progress.value * progress.value },
      { rotate: `${index * 31 * progress.value}deg` },
      { scale: .5 + progress.value * .7 },
    ],
  }));
  return <Animated.View style={[styles.piece, { backgroundColor: COLORS[index % COLORS.length], width: index % 4 ? 8 : 11, height: index % 4 ? 15 : 10 }, style]} />;
}

/** Care's status message stays separate from the global currency presentation.
 * Use an in-screen layer, not a native Modal that would cover the banner. */
export function CareQuestCelebration({ title, message, reward, icon='celebration', onClose }: {
  title: string; message?: string; reward?: number; icon?: 'celebration'|'heart'; onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  // Entrance belongs to this mounted completion, never a reward receipt or
  // changing callback. Animate the card only; the scrim and wallet stay put.
  const reduced = useRef(useReducedMotion()).current;
  const scale = useSharedValue(reduced ? 1 : .84), opacity = useSharedValue(0);
  useEffect(() => {
    if (!reduced) scale.value = withSpring(1, { mass: .6, stiffness: 300, damping: 8.5,
      energyThreshold: .0001, overshootClamping: false, reduceMotion: ReduceMotion.System });
    opacity.value = withTiming(1, { duration: reduced ? 160 : 120, reduceMotion: ReduceMotion.Never });
    const state = AppState.addEventListener('change', next => {
      if (next === 'active') return;
      cancelAnimation(scale); cancelAnimation(opacity); scale.value = 1; opacity.value = 1;
    });
    return () => { state.remove(); cancelAnimation(scale); cancelAnimation(opacity); };
  }, [reduced, scale, opacity]);
  const entrance = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close.current(); return true; });
    return () => back.remove();
  }, []);
  return <View accessibilityViewIsModal style={[StyleSheet.absoluteFillObject, styles.scrim, { zIndex: 100 }]}>
      {!reward && <View pointerEvents="none" style={styles.burst}>{Array.from({ length: 36 }, (_, index) => <ConfettiPiece key={index} index={index} />)}</View>}
      <Animated.View style={[styles.card, entrance]}>
        <Text style={styles.emoji}>{icon==='heart'?'❤️':'🎉'}</Text>
        <Text style={styles.title}>{title}</Text>
        {!!message&&<Text style={styles.message}>{message}</Text>}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Done</Text></Pressable>
      </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2A160E99', padding: 24 },
  burst: { position: 'absolute', top: '50%', left: '50%', zIndex: 2, alignItems: 'center', justifyContent: 'center' },
  piece: { position: 'absolute', borderRadius: 2 },
  card: { width: '100%', maxWidth: 350, borderRadius: 28, backgroundColor: '#FFF8EE', padding: 26, alignItems: 'center', gap: 12, shadowColor: '#321A0F', shadowOpacity: .25, shadowRadius: 18, elevation: 10 },
  emoji: { fontSize: 48 },
  title: { color: '#4C2B22', fontSize: 22, lineHeight: 28, fontWeight: '800', textAlign: 'center' },
  message: { color: '#69483A', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  button: { marginTop: 10, minHeight: 48, width: '100%', borderRadius: 25, backgroundColor: '#4C2B22', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
});
