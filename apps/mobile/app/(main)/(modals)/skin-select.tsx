import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { SKIN_COUNT } from '@novame/domain';
import { useTheme } from '../../../src/theme/use-theme';
import { haptics } from '../../../src/lib/haptics';
import { getCachedCompanion } from '../../../src/lib/companion-api';
import { getSelectedSkin, setSelectedSkin } from '../../../src/lib/cosmetics-store';
import { getCachedSubscriptionTier } from '../../../src/lib/subscription';
import { SKIN_IMAGES } from '../../../src/lib/cosmetic-images';
import {
  COSMETIC_PRICE,
  fetchCosmetics,
  getCachedCosmetics,
  isUnlocked,
  purchaseCosmetic,
  type CosmeticsState,
} from '../../../src/lib/cosmetics-api';

// The last two pet1 skins are Plus-exclusive (still cost clovers).
const PLUS_SKINS = new Set([5, 6]); // skin numbers (1-based)

/**
 * Skin center. Skins are bought with clovers (a flat price each); skin 1 is the
 * free default. The last two are Plus-exclusive -- they still cost clovers but
 * need an active subscription. Owned skins are selectable; unowned ones show
 * their price and buy on tap. Balance shows at the top.
 */
export default function SkinSelectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { theme } = useTheme();
  const c = theme.colors;

  const companion = getCachedCompanion();
  const companionId = companion?.companionId ?? 'pet1';
  const isPaid = getCachedSubscriptionTier() !== 'free';
  const skinArt = SKIN_IMAGES[companionId];

  const [cosmetics, setCosmetics] = useState<CosmeticsState>(() => getCachedCosmetics());
  const [selected, setSelected] = useState(() => getSelectedSkin(companionId));
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchCosmetics().then(setCosmetics);
    }, []),
  );

  function skinCosmeticId(skinNumber: number): string {
    return `${companionId}-skin${skinNumber}`;
  }

  function ownedFor(skinNumber: number): boolean {
    if (skinNumber === 1) return true; // default free skin
    return isUnlocked(cosmetics, 'skin', skinCosmeticId(skinNumber));
  }

  async function buy(skinNumber: number) {
    const plusOnly = PLUS_SKINS.has(skinNumber);
    if (plusOnly && !isPaid) {
      void haptics.warning();
      router.push('/(main)/(modals)/subscription-paywall');
      return;
    }
    if (cosmetics.balance < COSMETIC_PRICE) {
      void haptics.warning();
      Alert.alert('Not enough clovers', `You need ${COSMETIC_PRICE} clovers for this skin.`);
      return;
    }
    setBusy(true);
    const res = await purchaseCosmetic('skin', skinCosmeticId(skinNumber));
    setBusy(false);
    if (res.ok) {
      void haptics.success();
      setCosmetics(getCachedCosmetics());
      // Auto-select the freshly bought skin.
      setSelected(skinNumber);
      setSelectedSkin(companionId, skinNumber);
    } else if (res.error === 'plus_required') {
      router.push('/(main)/(modals)/subscription-paywall');
    } else if (res.error === 'insufficient') {
      Alert.alert('Not enough clovers', `You need ${COSMETIC_PRICE} clovers for this skin.`);
    } else if (res.error === 'already_owned') {
      setCosmetics(getCachedCosmetics());
    } else {
      Alert.alert('Something went wrong', 'Could not complete the purchase. Try again.');
    }
  }

  function onTap(skinNumber: number) {
    if (busy) return;
    if (ownedFor(skinNumber)) {
      void haptics.selection();
      setSelected(skinNumber);
      setSelectedSkin(companionId, skinNumber);
    } else {
      void buy(skinNumber);
    }
  }

  void c;
  const previewArt = skinArt?.[selected - 1];

  return (
    <View style={styles.root}>
      {/* ---- preview: wardrobe scene (tan placeholder until art lands) ---- */}
      <View style={[styles.preview, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn} hitSlop={12}>
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={styles.balancePill}>
          <Text style={styles.clover}>{'\u{1F340}'}</Text>
          <Text style={styles.balanceText}>{cosmetics.balance}</Text>
        </View>
        <View style={styles.previewCenter}>
          {previewArt ? (
            <Image source={previewArt} style={styles.previewImg} resizeMode="contain" />
          ) : (
            <MaterialIcons name="pets" size={96} color="#C9A87A" />
          )}
        </View>
      </View>

      {/* ---- brown shop panel (design: Get Your Outfit) ---- */}
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelHeaderEmoji}>{'👕'}</Text>
          <Text style={styles.panelHeaderText}>Get Your Outfit</Text>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
          {Array.from({ length: SKIN_COUNT }).map((_, index) => {
            const skinNumber = index + 1;
            const owned = ownedFor(skinNumber);
            const isActive = selected === skinNumber;
            const plusOnly = PLUS_SKINS.has(skinNumber);
            const art = skinArt?.[index];
            return (
              <Pressable
                key={index}
                onPress={() => onTap(skinNumber)}
                style={[styles.card, isActive && styles.cardActive]}
              >
                <View style={styles.thumb}>
                  {art ? (
                    <Image source={art} style={styles.thumbImg} resizeMode="contain" />
                  ) : (
                    <MaterialIcons name="checkroom" size={40} color="#B07A46" />
                  )}
                </View>
                {isActive ? (
                  <View style={styles.inUseBadge}>
                    <Text style={styles.inUseText}>In Use</Text>
                  </View>
                ) : owned ? (
                  <Text style={styles.ownedText}>Owned</Text>
                ) : (
                  <View style={styles.priceRow}>
                    {plusOnly && <Text style={styles.plusTag}>PLUS </Text>}
                    <Text style={styles.priceClover}>{'\u{1F340}'}</Text>
                    <Text style={styles.priceText}>{COSMETIC_PRICE}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

// Design palette (outfits change.png): tan wardrobe preview over a rich
// brown shop panel with light-orange item tiles.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#7B4B22' },

  preview: { height: '42%', backgroundColor: '#EFD9B8', paddingHorizontal: 16 },
  closeBtn: {
    position: 'absolute', left: 16, top: 54,
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#4A3220',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  balancePill: {
    position: 'absolute', left: 72, top: 58,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8,
    zIndex: 2,
  },
  balanceText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E7A3A' },
  clover: { fontSize: 16 },
  previewCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '70%', height: '85%' },

  panel: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 },
  panelHeaderEmoji: { fontSize: 22 },
  panelHeaderText: { fontSize: 21, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 32 },
  card: {
    width: '31%', marginBottom: 16, alignItems: 'center',
    backgroundColor: '#D9964F', borderRadius: 18, borderWidth: 3, borderColor: '#E8B088',
    paddingVertical: 12, paddingHorizontal: 8, gap: 8,
  },
  cardActive: { borderColor: '#FFFFFF' },
  thumb: { width: '86%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: '100%', height: '100%' },
  inUseBadge: { backgroundColor: '#4A3220', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  inUseText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  ownedText: { color: '#5A3A1B', fontSize: 13, fontFamily: 'Inter_700Bold' },
  plusTag: { color: '#FFE9B8', fontSize: 11, fontFamily: 'Inter_800ExtraBold', letterSpacing: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  priceClover: { fontSize: 14 },
});
