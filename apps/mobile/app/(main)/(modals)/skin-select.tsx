import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenOverlay as Modal } from '@/components/ui/screen-overlay';
import { appAlert } from '@/components/ui/app-dialog';
import { FixedColumnGrid } from '@/components/ui/fixed-column-grid';
import { useScreenOperation } from '@/lib/use-screen-operation';
import { withDeadline } from '@/lib/async-lifecycle';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { haptics } from '../../../src/lib/haptics';
import { prioritizeR2Image } from '../../../src/lib/download-queue';
import { useR2AssetRevision } from '../../../src/lib/use-r2-asset-revision';
import { ICONS } from '../../../src/lib/icons';
import { useSubscriptionTier } from '../../../src/lib/use-subscription-tier';
import {
  fetchCosmetics,
  getCachedCosmetics,
  isUnlocked,
  purchaseCosmetic,
  subscribeCosmetics,
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

type OutfitGridItem =
  | { kind: 'default' }
  | { kind: 'outfit'; outfit: OutfitDef };

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
  const isPaid = useSubscriptionTier() !== 'free';
  const assetRevision = useR2AssetRevision();

  const [catalog, setCatalog] = useState<OutfitDef[]>(() => getCachedOutfitCatalog());
  const [cosmetics, setCosmetics] = useState<CosmeticsState>(() => getCachedCosmetics());
  const [equipped, setEquipped] = useState<string | null>(() => getEquippedOutfitKey());
  const [previewKey, setPreviewKey] = useState<string | null>(() => getEquippedOutfitKey());
  const [busy, setBusy] = useState(false);
  // Blocking "Outfits Switching" overlay while the equipped video downloads.
  const [switching, setSwitching] = useState(false);
  const operation = useScreenOperation();
  const closing = useRef(false);
  const closeScreen = () => {
    if (closing.current) return;
    closing.current = true;
    operation.invalidate();
    setSwitching(false);
    router.back();
  };

  useEffect(() => subscribeCosmetics(setCosmetics), []);

  useFocusEffect(
    useCallback(() => {
      closing.current = false;
      setBusy(false);
      setSwitching(false);
      void fetchOutfitCatalog().then(setCatalog);
      void fetchCosmetics().then(setCosmetics);
    }, []),
  );

  // Prefetch worn-preview images so tapping cards feels instant.
  useEffect(() => {
    for (const o of catalog) void ExpoImage.prefetch(outfitAssetUrl(o.bunny, o.assetVersion));
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
    if (closing.current) return;
    const run = operation.begin();
    if (!run) return;
    setBusy(true);
    try {
    setEquippedOutfitKey(o.key);
    setEquipped(o.key);
    const cached = await withDeadline(getCachedOutfitVideoUri(o.key, o.assetVersion), 3000);
    if (!run.isCurrent()) return;
    if (!cached) {
      setSwitching(true);
      const uri = await withDeadline(ensureOutfitVideoCached(o), 12000).catch(() => null);
      if (!run.isCurrent()) return;
      setSwitching(false);
      if (!uri) {
        appAlert('Slow network', 'The outfit will finish downloading in the background.');
      }
    }
    closeScreen();
    } catch (error) {
      if (run.isCurrent()) {
        setSwitching(false);
        setBusy(false);
        appAlert('Could not switch outfit', 'Please try again. Downloads will continue in the background.');
      }
    } finally { run.finish(); }
  }

  async function buy(o: OutfitDef) {
    if (closing.current) return;
    if (o.plusOnly && !isPaid) {
      void haptics.pageOpen();
      router.push('/(main)/(modals)/subscription-paywall');
      return;
    }
    if (cosmetics.balance < o.price) {
      void haptics.warning();
      appAlert('Not enough clovers', `You need ${o.price} clovers for ${o.name}.`);
      return;
    }
    const run = operation.begin();
    if (!run) return;
    setBusy(true);
    const res = await withDeadline(purchaseCosmetic('outfit', o.key), 20000).catch(() => ({ ok: false as const, error: 'network' }));
    run.finish();
    if (!run.isCurrent()) return;
    setBusy(false);
    if (res.ok) {
      void haptics.success();
      setCosmetics(getCachedCosmetics());
      // Celebrate first (2026-08-08): equip + return to Home only after Done.
      appAlert('Purchase complete!', `${o.name} is yours — your bunny is putting it on.`, [
        { text: 'Done', onPress: () => void equipAndReturn(o) },
      ]);
    } else if (res.error === 'plus_required') {
      void haptics.pageOpen();
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
      closeScreen();
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
  const gridItems: OutfitGridItem[] = [
    { kind: 'default' },
    ...catalog.map((outfit) => ({ kind: 'outfit' as const, outfit })),
  ];

  return (
    <View style={styles.root}>
      {/* ---- fixed top: room art, uncropped, pinned to the top edge ---- */}
      <View style={styles.bgWrap}>
        <ExpoImage source={BG} style={styles.bgImg} contentFit="cover" />
        <ExpoImage
          source={preview ? { uri: outfitAssetUrl(preview.bunny, preview.assetVersion) } : DEFAULT_BUNNY}
          style={styles.bunny}
          contentFit="contain"
          transition={120}
          recyclingKey={`outfit-preview:${preview?.key ?? 'default'}:${assetRevision}`}
          onError={() => {
            if (preview) prioritizeR2Image(outfitAssetUrl(preview.bunny, preview.assetVersion));
          }}
        />
        <Pressable
          onPress={() => { void haptics.light(); closeScreen(); }}
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

        <FixedColumnGrid
          data={gridItems}
          columns={3}
          columnGap={12}
          rowGap={16}
          keyExtractor={(entry) => entry.kind === 'default' ? 'default' : entry.outfit.key}
          renderItem={(entry) => {
            if (entry.kind === 'default') {
              return (
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
              );
            }
            const o = entry.outfit;
            const isActive = equipped === o.key;
            const isSelected = previewKey === o.key;
            const plusLocked = o.plusOnly && !isPaid;
            return (
              <Pressable
                onPress={() => {
                  if (plusLocked) {
                    // Free user on a Plus outfit: straight to the paywall.
                    void haptics.pageOpen();
                    router.push('/(main)/(modals)/subscription-paywall');
                    return;
                  }
                  void haptics.selection();
                  setPreviewKey(o.key);
                }}
                style={[styles.card, isSelected && styles.cardSelected]}
              >
                <ExpoImage
                  source={{ uri: outfitAssetUrl(o.thumb, o.assetVersion) }}
                  style={styles.thumb}
                  contentFit="contain"
                  transition={100}
                  recyclingKey={`outfit-thumb:${o.key}:${assetRevision}`}
                  onError={() => prioritizeR2Image(outfitAssetUrl(o.thumb, o.assetVersion))}
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
          }}
        />

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

  card: {
    width: '100%', alignItems: 'center',
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
