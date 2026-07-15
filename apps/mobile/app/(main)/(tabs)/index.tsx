import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { requireAiConsent } from '@/lib/ai-consent';
import { haptics } from '@/lib/haptics';
import { hideSplashOnce } from '@/lib/splash';
import { fetchCompanion, getCachedCompanion, type CompanionState } from '@/lib/companion-api';
import { ICONS } from '@/lib/icons';
import { CompanionVideo } from '@/components/main/companion-video';
import { HOME_SCENE_BY_ID, DEFAULT_SCENE_ID } from '@novame/domain';
import { getSelectedScene } from '@/lib/cosmetics-store';
import { getFreshBubble } from '@/lib/bubble-store';
import { bubbleLineFor } from '@novame/domain';
import { SCENE_IMAGES } from '@/lib/cosmetic-images';
import { clearReflectLocal } from '@/lib/reflect-api';
import { clearQuietWinsLocal } from '@/lib/quiet-wins-api';
import { clearNewLensLocal } from '@/lib/lens-api';
import { clearTameEnemyLocal } from '@/lib/tame-enemy-api';
import { devSetTier, getCachedSubscriptionTier } from '@/lib/subscription';
import { CompanionSheet, type CompanionSheetRef } from '@/components/main/companion-sheet';

/**
 * Home. The companion lives here on a full-screen scene backdrop: a speech
 * bubble above the looping companion video, Focus + Reflect below, the settings
 * menu at top-left, and outfits / scenes / leaderboard at top-right. Tapping the
 * companion opens the interaction sheet with every Kit.
 *
 * The scene image fills the screen anchored to the top (tall screens scale up
 * from center so the bottom still covers; short screens keep the top and crop
 * the bottom). The companion is a transparent looping .mov.
 *
 * hideSplashOnce() must be called by whatever screen renders first, or the
 * native splash never lifts.
 */
function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
}

function speechFor(day: boolean, rotation: number): string {
  // A fresh AI line from the last reflection wins; otherwise a rotating default.
  const ai = getFreshBubble();
  if (ai) return ai;
  return bubbleLineFor(day, rotation);
}

export default function HomeScreen() {
  const router = useRouter();
  const sheetRef = useRef<CompanionSheetRef>(null);
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());
  const [tier, setTier] = useState(getCachedSubscriptionTier());
  const [, setCosmeticTick] = useState(0);
  const [bubbleRotation, setBubbleRotation] = useState(0);
  const day = isDaytime();
  void companion;

  useEffect(() => {
    const interval = setInterval(() => setBubbleRotation((r) => r + 1), 8000);
    return () => clearInterval(interval);
  }, []);

  const onLayout = useCallback(() => {
    hideSplashOnce();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setTier(getCachedSubscriptionTier());
      setCosmeticTick((t) => t + 1);
      sheetRef.current?.refresh();
      void fetchCompanion().then((c) => {
        if (c) setCompanion(c);
      });
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
  const onPetTap = () => {
    void haptics.medium();
    sheetRef.current?.present();
  };

  const scene = HOME_SCENE_BY_ID[getSelectedScene()] ?? HOME_SCENE_BY_ID[DEFAULT_SCENE_ID];
  const sceneArt = SCENE_IMAGES[scene.id];
  const sceneImg = sceneArt ? (day ? sceneArt.day : sceneArt.night) : undefined;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {sceneImg && (
        <Image source={sceneImg} style={styles.sceneBgImg} resizeMode="cover" />
      )}
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Top bar: menu (left) + outfits / scenes / leaderboard (right) */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.push('/(main)/(modals)/me')} hitSlop={8}>
            <Image source={ICONS.Menu} style={styles.topIcon} resizeMode="contain" />
          </Pressable>
          <View style={styles.topRight}>
            <Pressable onPress={() => { void haptics.light(); router.push('/(main)/(modals)/skin-select'); }} hitSlop={8}>
              <Image source={ICONS.Outfits} style={styles.topIcon} resizeMode="contain" />
            </Pressable>
            <Pressable onPress={() => { void haptics.light(); router.push('/(main)/(modals)/scene-select'); }} hitSlop={8}>
              <Image source={ICONS.Maps} style={styles.topIcon} resizeMode="contain" />
            </Pressable>
            <Pressable onPress={() => { void haptics.light(); router.push('/(main)/(modals)/ranking'); }} hitSlop={8}>
              <Image source={ICONS.Trophy} style={styles.topIcon} resizeMode="contain" />
            </Pressable>
          </View>
        </View>

        {/* Scene: speech bubble + companion video */}
        <View style={styles.scene}>
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{speechFor(day, bubbleRotation)}</Text>
            <View style={styles.bubbleTail} />
          </View>
          <CompanionVideo onPress={onPetTap} onReady={onLayout} />
        </View>

        {/* Permanent entries */}
        <View style={styles.ground}>
          <View style={styles.entries}>
            <Pressable onPress={onFocus} style={({ pressed }) => [styles.entryBtn, pressed && styles.entryBtnPressed]}>
              <Text style={styles.entryText}>Focus</Text>
            </Pressable>
            <Pressable onPress={onReflect} style={({ pressed }) => [styles.entryBtn, pressed && styles.entryBtnPressed]}>
              <Text style={styles.entryText}>Reflect</Text>
            </Pressable>
          </View>

          {__DEV__ && (
            <View style={styles.devRow}>
              <Pressable
                onPress={() => {
                  clearQuietWinsLocal();
                  clearNewLensLocal();
                  clearReflectLocal();
                  clearTameEnemyLocal();
                  Alert.alert('Reset done', 'Local kit + reflect flags cleared.');
                }}
                style={styles.devBtn}
              >
                <Text style={styles.devText}>[DEV] Reset kits</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const next = tier === 'free' ? 'plus' : 'free';
                  const ok = await devSetTier(next);
                  if (ok) {
                    setTier(next);
                    Alert.alert('Tier switched', `Now: ${next === 'free' ? 'FREE' : 'PAID'}`);
                  } else {
                    Alert.alert('Failed', 'Could not switch tier. Check connection.');
                  }
                }}
                style={styles.devBtn}
              >
                <Text style={styles.devText}>
                  [DEV] Now: {tier === 'free' ? 'FREE' : 'PAID'} (tap to switch)
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        <CompanionSheet ref={sheetRef} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E8D5B0' },
  // Background art fills the screen, anchored top: tall screens scale up from
  // center so the bottom still covers; short screens keep the top, crop bottom.
  sceneBgImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8,
  },
  topRight: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  topIcon: { width: 40, height: 40 },
  scene: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 140 },
  bubble: {
    backgroundColor: '#F4E4C1', borderRadius: 20, paddingHorizontal: 26, paddingVertical: 18,
    marginHorizontal: 24, maxWidth: '82%', marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  bubbleTail: {
    position: 'absolute', bottom: -10, alignSelf: 'center',
    width: 0, height: 0, borderLeftWidth: 11, borderRightWidth: 11, borderTopWidth: 12,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#F4E4C1',
  },
  bubbleText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#3A2E1A', textAlign: 'center', lineHeight: 24 },
  ground: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  entries: { flexDirection: 'row', gap: 16 },
  entryBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(244, 228, 193, 0.9)', borderRadius: 18, paddingVertical: 20,
    borderWidth: 2, borderColor: '#2A2A2A',
    shadowColor: '#2A2A2A', shadowOpacity: 0.5, shadowRadius: 0, shadowOffset: { width: 3, height: 4 },
    elevation: 4,
  },
  entryBtnPressed: {
    shadowOffset: { width: 1, height: 1 },
    transform: [{ translateX: 2 }, { translateY: 3 }],
  },
  entryText: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#3A2E1A' },
  devRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingTop: 4 },
  devBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 8 },
  devText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
});
