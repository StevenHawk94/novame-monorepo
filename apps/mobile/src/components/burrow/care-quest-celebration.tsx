import { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

/** A one-shot burst from screen centre, shared by care completion and Quest claims. */
export function CareQuestCelebration({ title, message, reward, onClose }: {
  title: string; message?: string; reward?: number; onClose: () => void;
}) {
  return <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
    <View style={styles.scrim}>
      <View pointerEvents="none" style={styles.burst}>{Array.from({ length: 36 }, (_, index) => <ConfettiPiece key={index} index={index} />)}</View>
      <View style={styles.card}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>{title}</Text>
        {!!message&&<Text style={styles.message}>{message}</Text>}
        {reward!=null&&<Text style={styles.reward}>🥕 +{reward} carrots</Text>}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Done</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

/** Quest rewards confirm immediately and disappear without an extra tap. */
export function QuestClaimBurst({ reward, onClose }: { reward: number; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => closeRef.current(), 1000);
    return () => clearTimeout(timer);
  }, [reward]);
  return <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
    <View pointerEvents="none" style={styles.questOverlay}>
      <View style={styles.burst}>{Array.from({ length: 36 }, (_, index) => <ConfettiPiece key={index} index={index} />)}</View>
      <View style={styles.questReward}><Text style={styles.questRewardText}>🥕 +{reward} Carrots</Text></View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2A160E99', padding: 24 },
  burst: { position: 'absolute', top: '50%', left: '50%', zIndex: 2, alignItems: 'center', justifyContent: 'center' },
  piece: { position: 'absolute', borderRadius: 2 },
  card: { width: '100%', maxWidth: 350, borderRadius: 28, backgroundColor: '#FFF8EE', padding: 26, alignItems: 'center', gap: 12, shadowColor: '#321A0F', shadowOpacity: .25, shadowRadius: 18, elevation: 10 },
  emoji: { fontSize: 48 },
  title: { color: '#4C2B22', fontSize: 26, fontWeight: '800', textAlign: 'center' },
  message: { color: '#69483A', fontSize: 17, textAlign: 'center', lineHeight: 24 },
  reward: { color: '#269364', fontSize: 22, fontWeight: '800', marginTop: 3 },
  button: { marginTop: 10, minHeight: 48, width: '100%', borderRadius: 25, backgroundColor: '#4C2B22', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  questOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  questReward: { borderRadius: 22, paddingHorizontal: 22, paddingVertical: 14, backgroundColor: '#FFF8EE', borderWidth: 2, borderColor: '#E8B36F', shadowColor: '#4C2B22', shadowOpacity: .2, shadowRadius: 10, elevation: 8 },
  questRewardText: { color: '#4C2B22', fontSize: 18, fontWeight: '800' },
});
