import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { BURROW_BACKGROUNDS } from '@/lib/burrow-art-assets';
import { decorationPreviewLayout } from '@/lib/burrow-home-layout';
import { HomeArtScene } from './home-art-scene';

const noop = () => {};

/** Uses the actual Home art and coordinates instead of a second miniature room.
 * The width is fitted first; only small/short screens scale further. The most
 * we can crop from the top is above the string lights at design Y=416. */
export function HomeArtPreview({ slots, photos, ownerId, away }: {
  slots: Record<string, MajorUpdateCatalogItem>;
  photos?: MajorUpdateBootstrap['roomPhotos'];
  ownerId: string;
  away?: boolean;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(Math.min(524, window.width - 36));
  const maxHeight = Math.max(360, window.height - insets.top - 96);
  const { artWidth, viewportHeight } = decorationPreviewLayout(width, maxHeight);
  return <View testID="burrow-decoration-preview" style={[styles.viewport, { height: viewportHeight }]}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Image source={BURROW_BACKGROUNDS.home} contentFit="cover" contentPosition="bottom" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
    <View pointerEvents="none" style={styles.dimmedBackground} />
    <View style={[styles.artFrame, { width: artWidth, height: viewportHeight }]}>
      <HomeArtScene previewOnly initialSize={{ width: artWidth, height: viewportHeight }} balance={0} slots={slots} photos={photos} ownerId={ownerId} away={away}
        onMenu={noop} onCarrots={noop} onAffection={noop} onAdventure={noop} onLetter={noop}
        onBurrows={noop} onDecorate={noop} onSlot={noop} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  viewport: { width: '100%', borderRadius: 24, overflow: 'hidden', backgroundColor: '#8D5136' },
  dimmedBackground: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(37, 20, 13, 0.35)' },
  artFrame: { alignSelf: 'center', overflow: 'hidden' },
});
