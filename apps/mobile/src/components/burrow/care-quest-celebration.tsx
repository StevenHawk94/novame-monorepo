import { useEffect, useRef } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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
export function CareQuestCelebration({ title, message, reward, onClose }: {
  title: string; message?: string; reward?: number; onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close.current(); return true; });
    return () => back.remove();
  }, []);
  return <View accessibilityViewIsModal style={[StyleSheet.absoluteFillObject, styles.scrim, { zIndex: 100 }]}>
      {!reward && <View pointerEvents="none" style={styles.burst}>{Array.from({ length: 36 }, (_, index) => <ConfettiPiece key={index} index={index} />)}</View>}
      <View style={styles.card}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>{title}</Text>
        {!!message&&<Text style={styles.message}>{message}</Text>}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Done</Text></Pressable>
      </View>
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
