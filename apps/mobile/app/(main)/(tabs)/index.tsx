import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { requireAiConsent } from '@/lib/ai-consent';
import { haptics } from '@/lib/haptics';
import { hideSplashOnce } from '@/lib/splash';
import { isQuietWinsDoneToday, clearQuietWinsLocal } from '@/lib/quiet-wins-api';
import { clearReflectLocal } from '@/lib/reflect-api';
import { isNewLensDoneToday, clearNewLensLocal } from '@/lib/lens-api';

/**
 * Home -- Phase A placeholder, growing Kit entries in Phase C.
 *
 * v1 was 697 lines: a companion video, a willpower bar, a speech bubble on a
 * 60s tick, three MMKV polls at 2s each, and four round header buttons. Phase C
 * rebuilds it around the companion's sleep/fly state and the day/night scene.
 *
 * Focus and Reflect are permanent entries (PRD 12). Quiet Wins is a daily Kit:
 * it disappears once done for the day and returns tomorrow, so its visibility
 * is read on focus (not just first mount) -- returning from a completed run
 * must drop the entry without a manual refresh.
 *
 * The AI-consent gate stays on Reflect: it pushes the consent modal and returns
 * false, and the modal replaces to `next` on Agree, so pushing again here would
 * double-navigate.
 *
 * hideSplashOnce() must be called by whatever screen renders first, or the
 * native splash never lifts.
 */
export default function HomeScreen() {
  const router = useRouter();
  const [quietWinsDone, setQuietWinsDone] = useState(false);
  const [newLensDone, setNewLensDone] = useState(false);

  const onLayout = useCallback(() => {
    hideSplashOnce();
  }, []);

  // Re-read the daily flag every time Home regains focus, so completing Quiet
  // Wins and coming back hides the entry immediately.
  useFocusEffect(
    useCallback(() => {
      setQuietWinsDone(isQuietWinsDoneToday());
      setNewLensDone(isNewLensDoneToday());
    }, []),
  );

  const onReflect = () => {
    void haptics.medium();
    if (!requireAiConsent('/(main)/reflect')) return;
    router.push('/(main)/reflect');
  };
  const onFocus = () => {
    void haptics.medium();
    router.push('/(main)/focus');
  };
  const onQuietWins = () => {
    void haptics.medium();
    router.push('/(main)/quiet-wins');
  };
  const onNewLens = () => {
    void haptics.medium();
    router.push('/(main)/new-lens');
  };
  const onTrueNorth = () => {
    void haptics.medium();
    router.push('/(main)/true-north');
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
          {!quietWinsDone && (
            <Pressable onPress={onQuietWins} style={styles.btn}>
              <Text style={styles.btnText}>Quiet Wins</Text>
            </Pressable>
          )}
          {!newLensDone && (
            <Pressable onPress={onNewLens} style={styles.btn}>
              <Text style={styles.btnText}>New Lens</Text>
            </Pressable>
          )}
          <Pressable onPress={onTrueNorth} style={styles.btn}>
            <Text style={styles.btnText}>True North</Text>
          </Pressable>
        </View>
        {__DEV__ && (
          <Pressable
            onPress={() => {
              clearQuietWinsLocal();
              clearNewLensLocal();
              clearReflectLocal();
              setQuietWinsDone(false);
              setNewLensDone(false);
            }}
            style={styles.devReset}
          >
            <Text style={styles.devResetText}>[DEV] Reset kit entries</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0B2E' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 32 },
  title: { color: 'rgba(255,255,255,0.35)', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16 },
  btn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: '#A855F7',
  },
  btnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  devReset: { marginTop: 24, paddingVertical: 8 },
  devResetText: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontFamily: 'Inter_500Medium' },
});
