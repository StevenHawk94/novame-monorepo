import { useCallback, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { requireAiConsent } from '@/lib/ai-consent';
import { haptics } from '@/lib/haptics';
import { hideSplashOnce } from '@/lib/splash';
import { fetchCompanion, getCachedCompanion, type CompanionState } from '@/lib/companion-api';
import { HOME_SCENE_BY_ID, DEFAULT_SCENE_ID } from '@novame/domain';
import { getSelectedScene, getSelectedSkin } from '@/lib/cosmetics-store';
import { SCENE_IMAGES, SKIN_IMAGES } from '@/lib/cosmetic-images';
import { clearReflectLocal } from '@/lib/reflect-api';
import { clearQuietWinsLocal } from '@/lib/quiet-wins-api';
import { clearNewLensLocal } from '@/lib/lens-api';
import { clearTameEnemyLocal } from '@/lib/tame-enemy-api';
import { devSetTier, getCachedSubscriptionTier } from '@/lib/subscription';
import { CompanionSheet, type CompanionSheetRef } from '@/components/main/companion-sheet';

/**
 * Home (C7). The companion lives here: a day/night scene, the pet in the middle
 * with a speech bubble, and the two permanent entries (Focus, Reflect) below.
 * Tapping the pet pulls up the interaction sheet with every Kit -- the daily
 * and weekly Kits no longer sit loose on Home, they live in that sheet.
 *
 * Scene art and pet art are placeholders (a tinted backdrop, an icon) until the
 * videos and backgrounds land; the layout and interaction are real. Day/night
 * is chosen from the local hour so the placeholder already shifts with time.
 *
 * hideSplashOnce() must be called by whatever screen renders first, or the
 * native splash never lifts.
 */
function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
}

function speechFor(day: boolean, companion: CompanionState | null): string {
  const name = companion?.name || 'me';
  void name;
  return day
    ? "I'm flowing through your shared moments."
    : "It's quiet now. A good time to look inward.";
}

export default function HomeScreen() {
  const router = useRouter();
  const sheetRef = useRef<CompanionSheetRef>(null);
  const [companion, setCompanion] = useState<CompanionState | null>(() => getCachedCompanion());
  const [tier, setTier] = useState(getCachedSubscriptionTier());
  const [panelOpen, setPanelOpen] = useState(false);
  const [, setCosmeticTick] = useState(0);
  const day = isDaytime();

  const onLayout = useCallback(() => {
    hideSplashOnce();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setTier(getCachedSubscriptionTier());
      // Re-read the selected scene/skin after returning from the panel screens.
      setCosmeticTick((t) => t + 1);
      // Returning from a Kit screen refocuses Home; refresh the sheet so a
      // just-completed daily Kit drops out of its list, even though the sheet
      // is a mounted component (no focus event of its own) sitting under the
      // Kit screen that was pushed on top of it.
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
  const sceneBg = day ? scene.dayBg : scene.nightBg;
  const groundBg = day ? scene.dayGround : scene.nightGround;
  const sceneArt = SCENE_IMAGES[scene.id];
  const sceneImg = sceneArt ? (day ? sceneArt.day : sceneArt.night) : undefined;
  const petId = companion?.companionId ?? 'pet1';
  const skinIndex = getSelectedSkin(petId) - 1;
  const skinImg = SKIN_IMAGES[petId]?.[skinIndex];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: sceneBg }]} edges={['top']} onLayout={onLayout}>
      {sceneImg && (
        <Image source={sceneImg} style={styles.sceneBgImg} resizeMode="cover" />
      )}
      {/* Top bar: menu + right buttons (placeholder) */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.push('/(main)/(modals)/me')}
          style={[styles.roundBtn, { backgroundColor: 'rgba(255,255,255,0.25)' }]}
          hitSlop={8}
        >
          <MaterialIcons name="menu" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.topRight}>
          <Pressable
            onPress={() => { void haptics.light(); setPanelOpen(true); }}
            style={[styles.roundBtn, { backgroundColor: 'rgba(255,255,255,0.25)' }]}
            hitSlop={8}
          >
            <MaterialIcons name="palette" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Scene: speech bubble + pet placeholder */}
      <View style={styles.scene}>
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{speechFor(day, companion)}</Text>
        </View>
        <Pressable onPress={onPetTap} style={styles.petTap} hitSlop={20}>
          {skinImg ? (
            <Image source={skinImg} style={styles.petImg} resizeMode="contain" />
          ) : (
            <View style={[styles.petPlaceholder, { backgroundColor: day ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)' }]}>
              <MaterialIcons name="pets" size={64} color={day ? '#5B8FB0' : '#C0B4F0'} />
            </View>
          )}
          <Text style={styles.tapHint}>Tap to interact</Text>
        </Pressable>
      </View>

      {/* Ground + permanent entries */}
      <View style={[styles.ground, { backgroundColor: groundBg }]}>
        <View style={styles.entries}>
          <Pressable onPress={onFocus} style={styles.entryBtn}>
            <MaterialIcons name="diamond" size={20} color="#E85B5B" />
            <Text style={styles.entryText}>Focus</Text>
          </Pressable>
          <Pressable onPress={onReflect} style={styles.entryBtn}>
            <MaterialIcons name="eco" size={20} color="#4CAF82" />
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

      {/* Personalization panel */}
      <Modal visible={panelOpen} transparent animationType="fade" onRequestClose={() => setPanelOpen(false)}>
        <Pressable style={styles.panelBackdrop} onPress={() => setPanelOpen(false)}>
          <Pressable style={styles.panelCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.panelHandle} />
            <Text style={styles.panelTitle}>Personalize</Text>
            <PanelRow icon="pets" label="Skins" desc="Change your companion's look"
              onPress={() => { setPanelOpen(false); router.push('/(main)/(modals)/skin-select'); }} />
            <PanelRow icon="wallpaper" label="Scenes" desc="Change the backdrop"
              onPress={() => { setPanelOpen(false); router.push('/(main)/(modals)/scene-select'); }} />
            <PanelRow icon="leaderboard" label="Leaderboard" desc="See where you stand"
              onPress={() => { setPanelOpen(false); router.push('/(main)/(modals)/ranking'); }} />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function PanelRow({ icon, label, desc, onPress }: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  desc: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.panelRow, { opacity: pressed ? 0.6 : 1 }]}>
      <View style={styles.panelRowIcon}>
        <MaterialIcons name={icon} size={22} color="#C084FC" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.panelRowLabel}>{label}</Text>
        <Text style={styles.panelRowDesc}>{desc}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color="rgba(255,255,255,0.3)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8,
  },
  topRight: { flexDirection: 'row', gap: 10 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sceneBgImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  petImg: { width: 140, height: 140 },

  scene: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  bubble: {
    backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 22, paddingVertical: 14,
    marginHorizontal: 24, maxWidth: '85%',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  bubbleText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#2A2A3A', textAlign: 'center' },
  petTap: { alignItems: 'center', gap: 10 },
  petPlaceholder: {
    width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center',
  },
  tapHint: { fontSize: 12, fontFamily: 'Inter_500Medium', color: 'rgba(0,0,0,0.4)' },

  ground: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, gap: 12 },
  entries: { flexDirection: 'row', gap: 12 },
  entryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 16, paddingVertical: 16,
  },
  entryText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#2A2A3A' },

  devRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingTop: 4 },
  devBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8 },
  panelBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  panelCard: { backgroundColor: '#1A1445', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  panelHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginBottom: 16 },
  panelTitle: { color: '#F0E8FF', fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 16 },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  panelRowIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(168,85,247,0.15)', alignItems: 'center', justifyContent: 'center' },
  panelRowLabel: { color: '#F0E8FF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  panelRowDesc: { color: '#9B8FBF', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  devText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.7)' },
});
