import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';

import { OUTFIT_UNLOCK_LEVELS } from '@novame/core';

import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import {
  getCachedCharacterState,
  switchOutfit,
} from '@/lib/character-state';

/**
 * Skins overlay -- Stage 3.10.3 D.
 *
 * 6-cell grid showing the 6 outfit options for char-1. Each cell shows
 * a static preview webp from the bundle (assets/characters/char-1-skinN.webp).
 *
 * Unlock rules from packages/core/constants/character.ts:
 *   OUTFIT_UNLOCK_LEVELS = [1, 5, 10, 20, 30, 50]
 *
 * The user's current level + unlocked outfits come from the
 * character-state cache (already warmed by Home tab on launch).
 *
 * Tapping an unlocked cell:
 *   - immediate visual selection (purple border)
 *   - calls switchOutfit() which POSTs to /api/character-state and
 *     refetches state, updating MMKV cache. The Home tab VideoCharacter
 *     reads the cache and will pick up the new outfit on next render
 *     (no remount -- the player swaps source via expo-video's setSource).
 *
 * Tapping a locked cell:
 *   - haptic warning, no other effect.
 *
 * UI mirrors the legacy capacitor design (image 3 in the stage 3.10.3
 * spec): grid 3x2, lock icon for locked cells, "Lv.N" badge, big purple
 * Close button at the bottom.
 */

// ---- preview images (bundled at compile time via require) ----

const SKIN_IMAGES: Record<number, ImageSourcePropType> = {
  1: require('@/../assets/characters/char-1-skin1.webp'),
  2: require('@/../assets/characters/char-1-skin2.webp'),
  3: require('@/../assets/characters/char-1-skin3.webp'),
  4: require('@/../assets/characters/char-1-skin4.webp'),
  5: require('@/../assets/characters/char-1-skin5.webp'),
  6: require('@/../assets/characters/char-1-skin6.webp'),
};

export default function SkinSelectModal() {
  const insets = useSafeAreaInsets();

  const cached = getCachedCharacterState();
  const [userId, setUserId] = useState<string | null>(null);
  const [level, setLevel] = useState<number>(cached?.level ?? 1);
  const [currentOutfit, setCurrentOutfit] = useState<number>(
    cached?.outfit ?? 1,
  );
  const [unlocked, setUnlocked] = useState<number[]>(
    cached?.unlockedOutfits ?? [1],
  );
  const [busy, setBusy] = useState<number | null>(null); // outfit num being switched

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUserId(data.session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = () => {
    void haptics.light();
    router.back();
  };

  const handlePickOutfit = async (outfitNum: number) => {
    const isUnlocked = unlocked.includes(outfitNum);
    if (!isUnlocked) {
      void haptics.warning();
      return;
    }
    if (outfitNum === currentOutfit) return; // already wearing
    if (busy !== null || !userId) return;

    void haptics.medium();
    setBusy(outfitNum);

    // Optimistic UI: flip selection immediately so the tap feels snappy.
    const prevOutfit = currentOutfit;
    setCurrentOutfit(outfitNum);

    try {
      const next = await switchOutfit(userId, outfitNum);
      // sync from server-canonical state in case anything else changed.
      setLevel(next.level);
      setCurrentOutfit(next.outfit);
      setUnlocked(next.unlockedOutfits);
      void haptics.success();
    } catch (e) {
      console.warn('[skin-select] switchOutfit failed:', e);
      // Roll back optimistic selection.
      setCurrentOutfit(prevOutfit);
      void haptics.error();
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      {/* Header (centered title, Skins is its own focal point so we
          actually rely on the centered "Skins" + level subtitle to brand
          the screen; close button bottom-right via the Close CTA). */}
      <View style={[styles.headerSpacer, { paddingTop: insets.top }]} />

      <View style={styles.titleBlock}>
        <Text style={styles.title}>Skins</Text>
        <Text style={styles.subtitle}>
          Lv. {level} · Select an outfit for your companion
        </Text>
      </View>

      {/* Grid */}
      <View style={styles.grid}>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const isUnlocked = unlocked.includes(n);
          const isSelected = currentOutfit === n;
          const isBusy = busy === n;
          const unlockLv = OUTFIT_UNLOCK_LEVELS[n - 1] ?? 1;

          return (
            <Pressable
              key={n}
              onPress={() => handlePickOutfit(n)}
              disabled={busy !== null}
              style={({ pressed }) => [
                styles.cell,
                isSelected && styles.cellSelected,
                !isUnlocked && styles.cellLocked,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.cellImageWrap}>
                <Image
                  source={SKIN_IMAGES[n]}
                  style={[styles.cellImg, !isUnlocked && styles.cellImgLocked]}
                  resizeMode="contain"
                />
                {isSelected ? (
                  <View style={styles.checkBadge}>
                    <MaterialIcons name="check" size={14} color="#FFFFFF" />
                  </View>
                ) : null}
                {!isUnlocked ? (
                  <View style={styles.lockOverlay}>
                    <MaterialIcons
                      name="lock"
                      size={20}
                      color="rgba(255,255,255,0.5)"
                    />
                  </View>
                ) : null}
                {isBusy ? (
                  <View style={styles.busyOverlay}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  </View>
                ) : null}
              </View>
              <View style={styles.cellLabelWrap}>
                <Text
                  style={[
                    styles.cellLabel,
                    !isUnlocked && styles.cellLabelLocked,
                  ]}
                >
                  Skin {n}
                </Text>
                <Text
                  style={[
                    styles.cellSublabel,
                    !isUnlocked && styles.cellSublabelLocked,
                  ]}
                >
                  {isUnlocked ? 'Unlocked' : `Lv.${unlockLv}`}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.flexSpacer} />

      {/* Close CTA */}
      <View
        style={[
          styles.closeWrap,
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        <Pressable
          onPress={handleClose}
          style={({ pressed }) => [
            styles.closeBtn,
            { opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- styles ----

const CELL_GAP = 12;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F0B2E',
  },
  headerSpacer: {
    paddingBottom: 8,
  },
  titleBlock: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 32,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 6,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '500',
  },
  // Grid
  grid: {
    paddingHorizontal: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CELL_GAP,
    justifyContent: 'center',
  },
  cell: {
    // 3 columns: (100% - 2 gaps) / 3. We use flexBasis percentages with
    // a small subtraction so gap math doesn't overflow on any screen.
    flexBasis: '30%',
    flexGrow: 0,
    aspectRatio: 0.85,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  cellSelected: {
    borderColor: '#A855F7',
  },
  cellLocked: {
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  cellImageWrap: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cellImg: {
    width: '85%',
    height: '85%',
  },
  cellImgLocked: {
    opacity: 0.25,
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockOverlay: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellLabelWrap: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  cellLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  cellLabelLocked: {
    color: 'rgba(255,255,255,0.5)',
  },
  cellSublabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    marginTop: 1,
  },
  cellSublabelLocked: {
    color: 'rgba(255,255,255,0.4)',
  },
  // Close
  flexSpacer: {
    flex: 1,
  },
  closeWrap: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  closeBtn: {
    paddingVertical: 16,
    backgroundColor: '#A855F7',
    borderRadius: 999,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
