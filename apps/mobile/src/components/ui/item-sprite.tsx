/**
 * ItemSprite — renders one memory item icon.
 *
 * Perf pass 2026-07-30: items are individual 256px webp files (sliced at
 * build time by tools/slice-item-images.py from the standardized sheets,
 * required via the generated item-images.g.ts map). Each tile decodes only
 * its own few-KB image — expo-image caches them independently, so grids
 * (Memories, Guided Reflect, feeds) paint all tiles at once instead of
 * popping in sheet-by-sheet as the old whole-sheet sprite windows decoded.
 *
 * Unknown item or missing art → the item's emoji if the dictionary has
 * one, else a blank tile — screens never break while art catches up.
 *
 * New batches: regenerate the dictionary, drop the standardized sheets in
 * assets/items/, then run tools/slice-item-images.py to refresh both the
 * per-item webps and the generated map.
 */
import { memo, useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { ITEM_IMAGES } from '../../lib/item-images.g';
import { TAP_PERSON_IMAGES } from '../../lib/tap-person-images';
import { mergedItemDictionary, remoteImageUri } from '../../lib/remote-items';
import { prioritizeR2Image } from '../../lib/download-queue';
import { getCachedRemoteItemManifest, subscribeRemoteItemManifest } from '../../lib/item-manifest-cache';

type Props = {
  itemId: string;
  size: number;
  radius?: number;
  /** Tile background behind the transparent art. Default: the app's lavender. */
  tileColor?: string;
  style?: StyleProp<ViewStyle>;
};

// Memoized: sprite tiles appear by the dozen in grids and feeds; props are
// value-stable, so memo turns tab re-renders into no-ops for every tile.
export const ItemSprite = memo(function ItemSprite({ itemId, size, radius = Math.round(size * 0.22), tileColor = '#F4F1F8', style }: Props) {
  useSyncExternalStore(
    subscribeRemoteItemManifest,
    () => getCachedRemoteItemManifest()?.version ?? '0',
    () => '0',
  );
  const remoteUri = remoteImageUri(itemId);
  const bundledArt = TAP_PERSON_IMAGES[itemId] ?? ITEM_IMAGES[itemId];
  const art = remoteUri ? { uri: remoteUri } : bundledArt;
  useEffect(() => {
    if (remoteUri) prioritizeR2Image(remoteUri);
  }, [remoteUri]);
  if (art == null) {
    const item = mergedItemDictionary().items[itemId];
    return (
      <View
        style={[
          styles.box,
          { width: size, height: size, borderRadius: radius, backgroundColor: tileColor },
          style,
        ]}
      >
        {item?.emoji ? (
          <Text style={{ fontSize: size * 0.55, lineHeight: size * 0.7 }}>{item.emoji}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.box,
        { width: size, height: size, borderRadius: radius, backgroundColor: tileColor },
        style,
      ]}
    >
      <Image source={art} placeholder={remoteUri ? bundledArt : undefined}
        placeholderContentFit="contain" style={{ width: size, height: size }} contentFit="contain" />
    </View>
  );
});

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
