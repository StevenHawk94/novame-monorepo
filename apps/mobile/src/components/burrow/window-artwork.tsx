import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ImageSource } from 'expo-image';
import { Image } from './burrow-image';
import { HOME_WINDOW_LANDSCAPES, type BurrowArtAsset } from '@/lib/burrow-art-assets';
import { useBurrowEnvironment } from '@/lib/use-burrow-environment';

/** Both originals are 512-square and already share the exact opening geometry.
 * Only the FRAME's bounds drive the outer anchor/thumbnail fit. Never crop or
 * independently fit the landscape to its smaller visible-alpha rectangle. */
export const WindowArtwork = memo(function WindowArtwork({ asset, landscape, style }: {
  asset: BurrowArtAsset; landscape: ImageSource; style: StyleProp<ViewStyle>;
}) {
  return <View pointerEvents="none" style={style} testID="seasonal-window">
    <Image source={landscape} contentFit="fill" style={StyleSheet.absoluteFillObject} testID="window-landscape"/>
    <Image source={asset.source} contentFit="fill" style={StyleSheet.absoluteFillObject} testID="window-frame"/>
  </View>;
});

/** Shop, Decorate, item detail and Collection use the same prepared environment
 * as Home. This wrapper is isolated so unrelated product cards never subscribe. */
export const SeasonalWindowArtwork = memo(function SeasonalWindowArtwork(props: {
  asset: BurrowArtAsset; style: StyleProp<ViewStyle>;
}) {
  const environment = useBurrowEnvironment();
  return <WindowArtwork {...props} landscape={HOME_WINDOW_LANDSCAPES[environment.season][environment.period]}/>;
});
