import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { HOME_SCENES } from '@novame/domain';
import { useTheme } from '../../../src/theme/use-theme';
import { haptics } from '../../../src/lib/haptics';
import { getSelectedScene, setSelectedScene } from '../../../src/lib/cosmetics-store';
import { getCachedSubscriptionTier } from '../../../src/lib/subscription';
import { SCENE_IMAGES } from '../../../src/lib/cosmetic-images';
import {
  COSMETIC_PRICE,
  fetchCosmetics,
  getCachedCosmetics,
  isUnlocked,
  purchaseCosmetic,
  type CosmeticsState,
} from '../../../src/lib/cosmetics-api';

function isDaytime(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 18;
}

// scene5 / scene6 are Plus-exclusive (still cost clovers).
const PLUS_SCENES = new Set(['scene5', 'scene6']);

/**
 * Scene switcher. Backdrops are bought with clovers; the ones marked free in the
 * domain are always available. Two scenes are Plus-exclusive (still cost
 * clovers, need a subscription). Owned scenes are selectable; unowned show their
 * price and buy on tap. Balance shows at the top.
 */
export default function SceneSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;
  const day = isDaytime();

  const isPaid = getCachedSubscriptionTier() !== 'free';
  const [cosmetics, setCosmetics] = useState<CosmeticsState>(() => getCachedCosmetics());
  const [selected, setSelected] = useState(() => getSelectedScene());
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchCosmetics().then(setCosmetics);
    }, []),
  );

  function ownedFor(scene: { id: string; free: boolean }): boolean {
    if (scene.free) return true;
    return isUnlocked(cosmetics, 'scene', scene.id);
  }

  async function buy(sceneId: string) {
    const plusOnly = PLUS_SCENES.has(sceneId);
    if (plusOnly && !isPaid) {
      void haptics.warning();
      router.push('/(main)/(modals)/subscription-paywall');
      return;
    }
    if (cosmetics.balance < COSMETIC_PRICE) {
      void haptics.warning();
      Alert.alert('Not enough clovers', `You need ${COSMETIC_PRICE} clovers for this scene.`);
      return;
    }
    setBusy(true);
    const res = await purchaseCosmetic('scene', sceneId);
    setBusy(false);
    if (res.ok) {
      void haptics.success();
      setCosmetics(getCachedCosmetics());
      setSelected(sceneId);
      setSelectedScene(sceneId);
    } else if (res.error === 'plus_required') {
      router.push('/(main)/(modals)/subscription-paywall');
    } else if (res.error === 'insufficient') {
      Alert.alert('Not enough clovers', `You need ${COSMETIC_PRICE} clovers for this scene.`);
    } else if (res.error === 'already_owned') {
      setCosmetics(getCachedCosmetics());
    } else {
      Alert.alert('Something went wrong', 'Could not complete the purchase. Try again.');
    }
  }

  function onTap(scene: { id: string; free: boolean }) {
    if (busy) return;
    if (ownedFor(scene)) {
      void haptics.selection();
      setSelected(scene.id);
      setSelectedScene(scene.id);
    } else {
      void buy(scene.id);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color="#6B5A45" />
      </Pressable>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleWarm}>Scenes</Text>
          <Text style={styles.subWarm}>Choose the world your companion lives in.</Text>
        </View>
        <View style={styles.balancePill}>
          <Text style={styles.balanceText}>{cosmetics.balance}</Text>
          <Text style={styles.clover}>{'\u{1F340}'}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
        {HOME_SCENES.map((scene) => {
          const owned = ownedFor(scene);
          const isActive = selected === scene.id;
          const plusOnly = PLUS_SCENES.has(scene.id);
          const art = SCENE_IMAGES[scene.id];
          const tint = day ? scene.dayBg : scene.nightBg;
          return (
            <Pressable
              key={scene.id}
              onPress={() => onTap(scene)}
              style={styles.card}
            >
              <View style={styles.thumb}>
                {art ? (
                  <Image source={day ? art.day : art.night} style={styles.thumbImg} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumbImg, { backgroundColor: tint }]} />
                )}
                {!owned && (
                  <View style={styles.priceOverlay}>
                    {plusOnly && <Text style={styles.plusTag}>PLUS</Text>}
                    <View style={styles.priceRow}>
                      <Text style={styles.priceText}>{COSMETIC_PRICE}</Text>
                      <Text style={styles.priceClover}>{'\u{1F340}'}</Text>
                    </View>
                  </View>
                )}
                {isActive && (
                  <View style={styles.inUseBadge}>
                    <Text style={styles.inUseText}>In Use</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardTitleWarm}>{scene.title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  titleWarm: { fontSize: 26, fontFamily: 'Inter_800ExtraBold', color: '#4A3220' },
  subWarm: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#8A7A63', marginTop: 4 },
  cardTitleWarm: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#4A3220', marginTop: 8 },
  inUseBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: '#4A3220', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  inUseText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Inter_800ExtraBold' },
  root: { flex: 1, paddingHorizontal: 20, backgroundColor: '#F2E6CB' },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 20 },
  title: { fontSize: 26, fontFamily: 'Inter_800ExtraBold' },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 4 },
  balancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#E8F5D8', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8,
  },
  balanceText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#4E7A3A' },
  clover: { fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 32 },
  card: { width: '48%', marginBottom: 18 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden', position: 'relative' },
  thumbImg: { width: '100%', height: '100%' },
  priceOverlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', gap: 4 },
  plusTag: { color: '#FFD98A', fontSize: 11, fontFamily: 'Inter_800ExtraBold', letterSpacing: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  priceText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  priceClover: { fontSize: 14 },
  activeBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
});
