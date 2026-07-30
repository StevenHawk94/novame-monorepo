import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../../src/lib/haptics';
import { ICONS } from '../../../src/lib/icons';
import { getCachedSubscriptionTier } from '../../../src/lib/subscription';
import { getSelectedScene, setSelectedScene } from '../../../src/lib/cosmetics-store';
import {
  DEFAULT_SCENE_KEY,
  DEFAULT_SCENE_THUMB,
  fetchSceneCatalog,
  getCachedSceneCatalog,
  sceneAssetUrl,
  type SceneDef,
} from '../../../src/lib/scenes';
import {
  fetchCosmetics,
  getCachedCosmetics,
  isUnlocked,
  purchaseCosmetic,
  type CosmeticsState,
} from '../../../src/lib/cosmetics-api';

/**
 * Unlock New Scenes (mock 1:1, 2026-07-30). Brown page: white close circle,
 * clover balance pill, centered title + Maps sticker, then a cream panel
 * with a golden border holding the 3-column scene grid. Slot 0 is the free
 * bundled default (Mushroom Wood); the rest come from the R2 manifest.
 * Plus-only scenes show a lock pill to free users and tap straight to the
 * paywall — same contract as the Bunny Closet.
 */
export default function SceneSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isPaid = getCachedSubscriptionTier() !== 'free';

  const [catalog, setCatalog] = useState<SceneDef[]>(() => getCachedSceneCatalog());
  const [cosmetics, setCosmetics] = useState<CosmeticsState>(() => getCachedCosmetics());
  const [current, setCurrent] = useState<string>(() => getSelectedScene());
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchSceneCatalog().then(setCatalog);
      void fetchCosmetics().then(setCosmetics);
    }, []),
  );

  // Warm the grid thumbs; full backgrounds are prefetched at launch.
  useEffect(() => {
    for (const s of catalog) void ExpoImage.prefetch(sceneAssetUrl(s.thumb));
  }, [catalog]);

  const isCurrent = (key: string) =>
    current === key || (key === DEFAULT_SCENE_KEY && /^scene\d+$/.test(current));
  const owned = (s: SceneDef) => isUnlocked(cosmetics, 'scene', s.key);

  /** Switch scene: make sure the big background is cached, then go Home. */
  async function useScene(key: string, imageUrl: string | null) {
    setSelectedScene(key);
    setCurrent(key);
    if (imageUrl) {
      setSwitching(true);
      try {
        await ExpoImage.prefetch(imageUrl);
      } catch { /* falls back to on-demand load on Home */ }
      setSwitching(false);
    }
    void haptics.success();
    router.back();
  }

  async function buyAndUse(s: SceneDef) {
    setBusy(true);
    const res = await purchaseCosmetic('scene', s.key);
    setBusy(false);
    if (res.ok) {
      setCosmetics(getCachedCosmetics());
      await useScene(s.key, sceneAssetUrl(s.image));
    } else if (res.error === 'plus_required') {
      router.push('/(main)/(modals)/subscription-paywall');
    } else if (res.error === 'insufficient') {
      Alert.alert('Not enough clovers', `You need ${s.price} clovers for ${s.name}.`);
    } else if (res.error === 'already_owned') {
      setCosmetics(getCachedCosmetics());
      await useScene(s.key, sceneAssetUrl(s.image));
    } else {
      Alert.alert('Something went wrong', 'Could not complete the purchase. Try again.');
    }
  }

  function onTap(s: SceneDef) {
    if (busy || switching || isCurrent(s.key)) return;
    if (s.plusOnly && !isPaid) {
      // Free user on a Plus scene: straight to the paywall (Closet contract).
      void haptics.warning();
      router.push('/(main)/(modals)/subscription-paywall');
      return;
    }
    if (owned(s)) {
      void haptics.selection();
      void useScene(s.key, sceneAssetUrl(s.image));
      return;
    }
    if (cosmetics.balance < s.price) {
      void haptics.warning();
      Alert.alert('Not enough clovers', `You need ${s.price} clovers for ${s.name}.`);
      return;
    }
    void haptics.light();
    Alert.alert(
      `Unlock ${s.name}?`,
      `This will spend ${s.price} clovers (you have ${cosmetics.balance}). Unlock and switch to this scene?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => void buyAndUse(s) },
      ],
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.topRow, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => { void haptics.light(); router.back(); }}
          style={styles.closeBtn}
          hitSlop={12}
        >
          <MaterialIcons name="close" size={24} color="#3A2E1A" />
        </Pressable>
        <View style={styles.balancePill}>
          <Image source={ICONS.Clovers} style={styles.cloverIcon} resizeMode="contain" />
          <Text style={styles.balanceText}>{cosmetics.balance}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.titleRow}>
          <Image source={ICONS.Maps} style={styles.mapsIcon} resizeMode="contain" />
          <Text style={styles.title}>Unlock New Scenes</Text>
        </View>
        <View style={styles.panel}>
          <View style={styles.grid}>
            {/* slot 0: the free bundled default */}
            <Pressable
              onPress={() => {
                if (busy || switching || isCurrent(DEFAULT_SCENE_KEY)) return;
                void haptics.selection();
                void useScene(DEFAULT_SCENE_KEY, null);
              }}
              style={styles.cell}
            >
              <ExpoImage source={DEFAULT_SCENE_THUMB} style={styles.thumb} contentFit="cover" />
              <Text style={styles.cellName} numberOfLines={1}>Mushroom Wood</Text>
              {isCurrent(DEFAULT_SCENE_KEY) ? (
                <View style={styles.currentChip}><Text style={styles.currentText}>Currently</Text></View>
              ) : (
                <Text style={styles.ownedText}>Free</Text>
              )}
            </Pressable>

            {catalog.map((s) => {
              const plusLocked = s.plusOnly && !isPaid;
              return (
                <Pressable key={s.key} onPress={() => onTap(s)} style={styles.cell}>
                  <ExpoImage
                    source={{ uri: sceneAssetUrl(s.thumb) }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={100}
                  />
                  <Text style={styles.cellName} numberOfLines={1}>{s.name}</Text>
                  {isCurrent(s.key) ? (
                    <View style={styles.currentChip}><Text style={styles.currentText}>Currently</Text></View>
                  ) : plusLocked ? (
                    <View style={styles.plusPill}>
                      <MaterialIcons name="lock" size={12} color="#FFFFFF" />
                      <Text style={styles.plusPillText}>PLUS</Text>
                    </View>
                  ) : owned(s) ? (
                    <Text style={styles.ownedText}>Owned</Text>
                  ) : (
                    <View style={styles.priceRow}>
                      <Image source={ICONS.Clovers} style={styles.priceClover} resizeMode="contain" />
                      <Text style={styles.priceText}>{s.price}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* blocking wait while the scene background caches */}
      <Modal visible={switching} transparent animationType="fade">
        <View style={styles.switchOverlay}>
          <View style={styles.switchCard}>
            <ActivityIndicator size="large" color="#8A6240" />
            <Text style={styles.switchTitle}>Scene Switching…</Text>
            <Text style={styles.switchSub}>Setting up the new home</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Palette from the Unlock New Scenes mock: deep brown page, cream panel with
// a golden border, dark-brown chips, green prices.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#5F3A1E' },

  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  closeBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  balancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
  },
  cloverIcon: { width: 22, height: 22 },
  balanceText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E7A3A' },

  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    marginTop: 14, marginBottom: 14,
  },
  title: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },
  mapsIcon: { width: 44, height: 44 },

  scroll: { paddingHorizontal: 14 },
  panel: {
    backgroundColor: '#FBF3DF', borderRadius: 30, borderWidth: 4, borderColor: '#E8B54D',
    paddingHorizontal: 14, paddingVertical: 18,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '3.5%' },
  cell: { width: '31%', alignItems: 'center', marginBottom: 20 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 22 },
  cellName: {
    fontSize: 15, fontFamily: 'Inter_800ExtraBold', color: '#4A3220',
    marginTop: 8, marginBottom: 5,
  },
  currentChip: { backgroundColor: '#4A3220', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  currentText: { color: '#FFFFFF', fontSize: 12.5, fontFamily: 'Inter_700Bold' },
  plusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#4A3220', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 5,
  },
  plusPillText: { color: '#FFFFFF', fontSize: 11.5, fontFamily: 'Inter_800ExtraBold', letterSpacing: 0.6 },
  ownedText: { color: '#8A6240', fontSize: 12.5, fontFamily: 'Inter_700Bold' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceClover: { width: 16, height: 16 },
  priceText: { color: '#2E7A3A', fontSize: 14, fontFamily: 'Inter_800ExtraBold' },

  switchOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  switchCard: {
    backgroundColor: '#FBF3DF', borderRadius: 28, paddingVertical: 30, paddingHorizontal: 40,
    alignItems: 'center', gap: 14,
  },
  switchTitle: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },
  switchSub: { fontSize: 13.5, fontFamily: 'Inter_500Medium', color: '#8A7A63' },
});
