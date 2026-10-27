import { Image } from 'expo-image';
import { decodeNativeImage } from '@/lib/native-image-decoder';
import type { ImageRef } from 'expo-image';
import { Platform } from 'react-native';
import { TAP_DAY_IMAGES } from '@/lib/tap-day-images.g';
import { TAP_DAY_ICON_SCALE, tapDayIconSize } from '@/lib/tap-day-icon-layout';

const decoded = new Map<string, ImageRef>();
let warmup: Promise<void> = Promise.resolve();
/** Small bounded native decode; never a fetch, and never required to open the page. */
export function warmTapDayIcons(ids: readonly string[]) {
  if (Platform.OS !== 'ios') return Promise.resolve();
  warmup = warmup.then(async () => {
    const pending = [...new Set(ids)].filter(id => TAP_DAY_IMAGES[id] && !decoded.has(id));
    for (let i = 0; i < pending.length; i += 6) await Promise.all(pending.slice(i, i + 6).map(async id => {
      try { decoded.set(id, await decodeNativeImage(TAP_DAY_IMAGES[id], { maxWidth: 96, maxHeight: 96 })); } catch { /* Bundled fallback still renders. */ }
    }));
  }).catch(() => {});
  return warmup;
}

/** Selection art is always bundled: no manifest subscriptions, URLs or download queue. */
export function TapDayIcon({ itemId, size = 58, radius = 11 }: { itemId: string; size?: number; radius?: number }) {
  const displaySize = tapDayIconSize(size);
  return <Image source={decoded.get(itemId) ?? TAP_DAY_IMAGES[itemId]} contentFit="contain" transition={0}
    style={{ width: displaySize, height: displaySize, borderRadius: radius * TAP_DAY_ICON_SCALE, backgroundColor: '#F4F1F8' }} />;
}
