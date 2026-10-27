import { memo, useEffect, useMemo, useState } from 'react';
import {useIsFocused} from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import { Image } from './burrow-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MajorUpdateBootstrap, MajorUpdateCatalogItem } from '@/lib/app-major-update-api';
import { burrowArtForItem, burrowArtFor } from '@/lib/burrow-art-assets';
import { decorationPreviewLayout } from '@/lib/burrow-home-layout';
import { HomeArtScene } from './home-art-scene';
import {useBunnyVariant} from '@/lib/bunny-identity';
import {afterUiSettles} from '@/lib/ui-idle';
import {createDecorationPreviewWarmer,decorationPreviewArt} from '@/lib/decoration-preview-preparation';

const noop = () => {};

/** Uses the actual Home art and coordinates instead of a second miniature room.
 * The width is fitted first; only small/short screens scale further. The most
 * we can crop from the top is above the string lights at design Y=416. */
export const HomeArtPreview = memo(function HomeArtPreview({ slots, photos, ownerId, away, availableHeight, onSlot, timeZone, now }: {
  timeZone?: string | null;
  now?: number;
  slots: Record<string, MajorUpdateCatalogItem>;
  photos?: MajorUpdateBootstrap['roomPhotos'];
  ownerId: string;
  away?: boolean;
  availableHeight?: number;
  onSlot?: (slot: string) => void;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const focused=useIsFocused(),variant=useBunnyVariant(ownerId);
  const warmer=useMemo(()=>createDecorationPreviewWarmer(),[]);
  useEffect(()=>{
    if(!focused)return;
    // Selection has already committed. Never debounce the foreground draft or
    // hold it behind a decode promise. Only speculative background work waits.
    const cancel=afterUiSettles(()=>warmer.warm(decorationPreviewArt(slots,variant)));
    return()=>{cancel();warmer.cancel();};
  },[focused,slots,variant,warmer,ownerId]);
  const [width, setWidth] = useState(Math.min(524, window.width - 36));
  const maxHeight = availableHeight ?? Math.max(360, window.height - insets.top - 96);
  const { artWidth, viewportHeight } = decorationPreviewLayout(width, maxHeight);
  return <View testID="burrow-decoration-preview" style={[styles.viewport, { height: viewportHeight }]}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <Image source={(burrowArtForItem(slots.wallpaper, 'wallpapers') ?? burrowArtFor('wallpapers'))!.source} contentFit="cover" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
    <View pointerEvents="none" style={styles.dimmedBackground} />
    <View style={[styles.artFrame, { width: artWidth, height: viewportHeight }]}>
      <HomeArtScene timeZone={timeZone} now={now} previewOnly previewBottomCrop={300} initialSize={{ width: artWidth, height: viewportHeight }} balance={0} slots={slots} photos={photos} ownerId={ownerId} away={away}
        onMenu={noop} onCarrots={noop} onAffection={noop} onAdventure={noop} onLetter={noop}
        onBurrows={noop} onDecorate={noop} onSlot={onSlot ?? noop} previewInteractive={!!onSlot} />
    </View>
  </View>;
});

const styles = StyleSheet.create({
  viewport: { width: '100%', borderRadius: 24, overflow: 'hidden', backgroundColor: '#8D5136' },
  dimmedBackground: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(37, 20, 13, 0.35)' },
  artFrame: { alignSelf: 'center', overflow: 'hidden' },
});
