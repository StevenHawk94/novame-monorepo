import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { requireAiConsent } from '@/lib/ai-consent';
import { haptics } from '@/lib/haptics';
import { hideSplashOnce } from '@/lib/splash';

/**
 * Home -- Phase A placeholder.
 *
 * v1 was 697 lines: a companion video, a willpower bar, a speech bubble on a
 * 60s tick, three MMKV polls at 2s each, and four round header buttons. All of
 * it read from character-state or wisdom-center. Phase C rebuilds it around
 * the companion's sleep/fly state and the day/night scene.
 *
 * The two entries survive because they are the product (PRD 12): Focus and
 * Reflect both start here. The AI-consent gate stays on Reflect: it pushes the
 * consent modal and returns false, and the modal replaces to `next` on Agree,
 * so pushing again here would double-navigate.
 *
 * hideSplashOnce() must be called by whatever screen renders first, or the
 * native splash never lifts.
 */
export default function HomeScreen() {
  const router = useRouter();

  const onLayout = useCallback(() => {
    hideSplashOnce();
  }, []);

  const onReflect = () => {
    void haptics.medium();
    if (!requireAiConsent('/(main)/reflect')) return;
    router.push('/(main)/reflect');
  };

  const onFocus = () => {
    void haptics.medium();
    router.push('/(main)/focus');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} onLayout={onLayout}>
      <View style={styles.center}>
        <Text style={styles.title}>Home</Text>
        <View style={styles.actions}>
          <Pressable onPress={onFocus} style={styles.btn}>
            <Text style={styles.btnText}>Focus</Text>
          </Pressable>
          <Pressable onPress={onReflect} style={styles.btn}>
            <Text style={styles.btnText}>Reflect</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 },
  title: { color: 'rgba(255,255,255,0.35)', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  actions: { flexDirection: 'row', gap: 16 },
  btn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: '#A855F7',
  },
  btnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
