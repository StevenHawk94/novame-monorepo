import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appAlert } from '@/components/ui/app-dialog';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../../src/lib/haptics';
import { ICONS } from '../../../src/lib/icons';
import { getCachedSubscriptionTier } from '../../../src/lib/subscription';
import {
  fetchCosmetics,
  getCachedCosmetics,
  isUnlocked,
  purchaseCosmetic,
  type CosmeticsState,
} from '../../../src/lib/cosmetics-api';
import {
  ensureOutfitVideoCached,
  fetchOutfitCatalog,
  getCachedOutfitCatalog,
  getCachedOutfitVideoUri,
  getEquippedOutfitKey,
  outfitAssetUrl,
  setEquippedOutfitKey,
  type OutfitDef,
} from '../../../src/lib/outfits';

// outfits-background.webp is 550×400; shown full-bleed width, uncropped,
// pinned to the very top of the screen (design 2026-07-30). NO spaces in
// asset filenames — Metro fails silently on them (see HANDOFF §6).
const BG = require('../../../assets/Background/outfits-background.webp');
const BG_ASPECT = 550 / 400;
// The bunny's default look (no outfit) — shown whenever the "none" slot is
// previewed or nothing is equipped yet.
const DEFAULT_BUNNY = require('../../../assets/Background/Default.webp');

/**
 * Bunny Closet (mock 1:1). Fixed top band: the room art, close X, clover
 * balance pill, and the previewed outfit's -Bunny.webp worn shot. Everything
 * below the art — title included — scrolls as one region. The catalog comes
 * from R2's video-manifest (prices/plus flags server-trusted on purchase),
 * so new outfits appear without an app release.
 */
export default function OutfitClosetScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isPaid = getCachedSubscriptionTier() !== 'free';

  const [catalog, setCatalog] = useState<OutfitDef[]>(() => getCachedOutfitCatalog());
  const [cosmetics, setCosmetics] = useState<CosmeticsState>(() => getCachedCosmetics());
  const [equipped, setEquipped] = useState<string | null>(() => getEquippedOutfitKey());
  const [previewKey, setPreviewKey] = useState<string | null>(() => getEquippedOutfitKey());
  const [busy, setBusy] = useState(false);
  // Blocking "Outfits Switching" overlay while the equipped video downloads.
  const [switching, setSwitching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void fetchOutfitCatalog().then(setCatalog);
      void fetchCosmetics().then(setCosmetics);
    }, []),
  );

  // Prefetch worn-preview images so tapping cards feels instant.
  useEffect(() => {
    for (const o of catalog) void ExpoImage.prefetch(outfitAssetUrl(o.bunny));
  }, [catalog]);

  const preview = catalog.find((o) => o.key === previewKey) ?? null;
  const owned = (o: OutfitDef) => isUnlocked(cosmetics, 'outfit', o.key);

  /**
   * Equip + return to Home. If the loop video isn't cached yet, a blocking
   * "Outfits Switching" modal holds the screen until it lands (usually a
   * blink — the launch prefetch has warmed most of them), then closes and
   * navigates back so Home picks the clip up on focus.
   */
  async function equipAndReturn(o: OutfitDef) {
    setEquippedOutfitKey(o.key);
    setEquipped(o.key);
    const cached = await getCachedOutfitVideoUri(o.key);
    if (!cached) {
      setSwitching(true);
      const uri = await ensureOutfitVideoCached(o);
      setSwitching(false);
      if (!uri) {
        appAlert('Slow network', 'The outfit will finish downloading in the background.');
      }
    }
    router.back();
  }

  async function buy(o: OutfitDef) {
    if (o.plusOnly && !isPaid) {
      void haptics.warning();
      router.push('/(main)/(modals)/subscription-paywall');
      return;
    }
    if (cosmetics.balance < o.price) {
      void haptics.warning();
      appAlert('Not enough clovers', `You need ${o.price} clovers for ${o.name}.`);
      return;
    }
    setBusy(true);
    const res = await purchaseCosmetic('outfit', o.key);
    setBusy(false);
    if (res.ok) {
      void haptics.success();
      setCosmetics(getCachedCosmetics());
      await equipAndReturn(o);
    } else if (res.error === 'plus_required') {
      router.push('/(main)/(modals)/subscription-paywall');
    } else if (res.error === 'insufficient') {
      appAlert('Not enough clovers', `You need ${o.price} clovers for ${o.name}.`);
    } else if (res.error === 'already_owned') {
      setCosmetics(getCachedCosmetics());
      await equipAndReturn(o);
    } else {
      appAlert('Something went wrong', 'Could not complete the purchase. Try again.');
    }
  }

  function onAction() {
    if (busy || switching) return;
    if (!preview) {
      // Default look selected: unequip → Home returns to the default video
      // (bundled, so no download wait).
      if (equipped === null) return;
      void haptics.success();
      setEquippedOutfitKey(null);
      setEquipped(null);
      router.back();
      return;
    }
    if (equipped === preview.key) return;
    if (owned(preview)) {
      void haptics.success();
      void equipAndReturn(preview);
    } else {
      void buy(preview);
    }
  }

  const isInUse = preview ? equipped === preview.key : equipped === null;
  const actionLabel = !preview
    ? isInUse ? 'In Use' : 'Use'
    : isInUse
      ? 'In Use'
      : owned(preview)
        ? 'Use'
        : String(preview.price);
  const showActionClover = preview !== null && !isInUse && !owned(preview);

  return (
    <View style={styles.root}>
      {/* ---- fixed top: room art, uncropped, pinned to the top edge ---- */}
      <View style={styles.bgWrap}>
        <ExpoImage source={BG} style={styles.bgImg} contentFit="cover" />
        <ExpoImage
          source={preview ? { uri: outfitAssetUrl(preview.bunny) } : DEFAULT_BUNNY}
          style={styles.bunny}
          contentFit="contain"
          transition={120}
        />
        <Pressable
          onPress={() => { void haptics.light(); router.back(); }}
          style={[styles.closeBtn, { top: insets.top + 8 }]}
          hitSlop={12}
        >
          <MaterialIcons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={[styles.balancePill, { top: insets.top + 8 }]}>
          <Image source={ICONS.Clovers} style={styles.cloverIcon} resizeMode="contain" />
          <Text style={styles.balanceText}>{cosmetics.balance}</Text>
        </View>
      </View>

      {/* ---- everything below the art scrolls as one region ---- */}
      <ScrollView
        style={styles.panel}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.panelContent, { paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.panelHeader}>
          <Image source={ICONS.Outfits} style={styles.headerIcon} resizeMode="contain" />
          <Text style={styles.panelHeaderText}>Bunny Closet</Text>
        </View>

        <View style={styles.grid}>
          {/* slot 0: no outfit — the bunny's default look */}
          <Pressable
            onPress={() => { void haptics.selection(); setPreviewKey(null); }}
            style={[styles.card, styles.noneCard, previewKey === null && styles.cardSelected]}
          >
            <View style={styles.noneIconWrap}>
              <MaterialIcons name="block" size={52} color="#4A3220" />
            </View>
            {equipped === null ? (
              <View style={styles.inUseBadge}>
                <Text style={styles.inUseText}>In Use</Text>
              </View>
            ) : (
              <Text style={styles.ownedText}>Default</Text>
            )}
          </Pressable>
          {catalog.map((o) => {
            const isActive = equipped === o.key;
            const isSelected = previewKey === o.key;
            const plusLocked = o.plusOnly && !isPaid;
            return (
              <Pressable
                key={o.key}
                onPress={() => {
                  if (plusLocked) {
                    // Free user on a Plus outfit: straight to the paywall.
                    void haptics.warning();
                    router.push('/(main)/(modals)/subscription-paywall');
                    return;
                  }
                  void haptics.selection();
                  setPreviewKey(o.key);
                }}
                style={[styles.card, isSelected && styles.cardSelected]}
              >
                <ExpoImage
                  source={{ uri: outfitAssetUrl(o.thumb) }}
                  style={styles.thumb}
                  contentFit="contain"
                  transition={100}
                />
                {plusLocked ? (
                  <View style={styles.plusPill}>
                    <MaterialIcons name="lock" size={14} color="#FFFFFF" />
                    <Text style={styles.plusPillText}>PLUS</Text>
                  </View>
                ) : isActive ? (
                  <View style={styles.inUseBadge}>
                    <Text style={styles.inUseText}>In Use</Text>
                  </View>
                ) : owned(o) ? (
                  <Text style={styles.ownedText}>Owned</Text>
                ) : (
                  <View style={styles.priceRow}>
                    <Image source={ICONS.Clovers} style={styles.priceClover} resizeMode="contain" />
                    <Text style={styles.priceText}>{o.price}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {catalog.length === 0 && (
          <Text style={styles.emptyText}>Loading the closet…</Text>
        )}
      </ScrollView>

      {/* fixed bottom action: buy / use / in use — always visible */}
      {catalog.length > 0 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            onPress={onAction}
            disabled={busy || switching || isInUse}
            style={({ pressed }) => [
              styles.actionBtn,
              (busy || switching || isInUse) && { opacity: 0.6 },
              pressed && !isInUse && { transform: [{ translateY: 1 }] },
            ]}
          >
            {showActionClover && (
              <Image source={ICONS.Clovers} style={styles.actionClover} resizeMode="contain" />
            )}
            <Text style={styles.actionText}>{busy ? '…' : actionLabel}</Text>
          </Pressable>
        </View>
      )}

      {/* blocking wait while the outfit's loop video downloads */}
      <Modal visible={switching} transparent animationType="fade">
        <View style={styles.switchOverlay}>
          <View style={styles.switchCard}>
            <ActivityIndicator size="large" color="#8A6240" />
            <Text style={styles.switchTitle}>Outfits Switching…</Text>
            <Text style={styles.switchSub}>Getting your bunny dressed</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Palette from the Bunny Closet mock: deep brown panel, cream cards with a
// soft blush border, white action button with green price.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#5F3A1E' },

  bgWrap: { width: '100%', aspectRatio: BG_ASPECT },
  bgImg: { ...StyleSheet.absoluteFillObject },
  bunny: {
    position: 'absolute', alignSelf: 'center', bottom: '6%',
    width: '52%', height: '72%',
  },
  closeBtn: {
    position: 'absolute', left: 16,
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#4A3220',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  balancePill: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
    zIndex: 2,
  },
  cloverIcon: { width: 22, height: 22 },
  balanceText: { fontSize: 17, fontFamily: 'Inter_800ExtraBold', color: '#2E7A3A' },

  panel: { flex: 1 },
  panelContent: { paddingHorizontal: 18, paddingTop: 22 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 18 },
  headerIcon: { width: 34, height: 34 },
  panelHeaderText: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: '#FFFFFF' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '3.5%' },
  card: {
    width: '31%', marginBottom: 16, alignItems: 'center',
    backgroundColor: '#FBF3DF', borderRadius: 22, borderWidth: 2.5, borderColor: '#E3B7A0',
    paddingVertical: 12, paddingHorizontal: 8, gap: 8,
  },
  cardSelected: { borderColor: '#FFFFFF' },
  noneCard: { justifyContent: 'center' },
  noneIconWrap: { width: '84%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '84%', aspectRatio: 1 },
  inUseBadge: { backgroundColor: '#4A3220', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5 },
  inUseText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_800ExtraBold' },
  ownedText: { color: '#8A6240', fontSize: 13, fontFamily: 'Inter_700Bold' },
  plusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#4A3220', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 6,
  },
  plusPillText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_800ExtraBold', letterSpacing: 0.8 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceClover: { width: 18, height: 18 },
  priceText: { color: '#2E7A3A', fontSize: 15, fontFamily: 'Inter_800ExtraBold' },

  emptyText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center', paddingVertical: 32 },

  footer: { paddingHorizontal: 32, paddingTop: 10, backgroundColor: '#5F3A1E' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 17,
  },
  actionClover: { width: 24, height: 24 },
  actionText: { fontSize: 19, fontFamily: 'Inter_800ExtraBold', color: '#2E7A3A' },

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
