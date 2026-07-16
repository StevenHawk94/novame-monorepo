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

  return (
    <View style={[styles.root, { backgroundColor: c.bgPrimary, paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
        <MaterialIcons name="arrow-back" size={24} color={c.textSecondary} />
      </Pressable>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.textPrimary }]}>Skins</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>Unlock new looks with clovers.</Text>
        </View>
        <View style={styles.balancePill}>
          <Text style={styles.balanceText}>{cosmetics.balance}</Text>
          <Text style={styles.clover}>{'\u{1F340}'}</Text>
        </View>
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
              style={[styles.card, isActive && { borderColor: c.brand.primary, borderWidth: 3 }]}
            >
              <View style={[styles.thumb, { backgroundColor: c.bgCard }]}>
                {art ? (
                  <Image source={art} style={styles.thumbImg} resizeMode="contain" />
                ) : (
                  <MaterialIcons name="pets" size={40} color={c.textMuted} />
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
                  <View style={[styles.activeBadge, { backgroundColor: c.brand.primary }]}>
                    <MaterialIcons name="check" size={14} color="#FFFFFF" />
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 20 },
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
  card: { width: '31%', marginBottom: 14 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden', position: 'relative', alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: '100%', height: '100%' },
  priceOverlay: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', gap: 4 },
  plusTag: { color: '#FFD98A', fontSize: 11, fontFamily: 'Inter_800ExtraBold', letterSpacing: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  priceText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  priceClover: { fontSize: 13 },
  activeBadge: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
