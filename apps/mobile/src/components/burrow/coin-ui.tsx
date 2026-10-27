import { Fragment, memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import type { ImageProps } from 'expo-image';
import { COIN_UI_ASSET } from '@/lib/coin-ui-asset';
import { Image } from './burrow-image';

export const CoinIcon = memo(function CoinIcon({ size = 24, style }: { size?: number; style?: ImageProps['style'] }) {
  return <Image source={COIN_UI_ASSET} contentFit="contain" cachePolicy="memory-disk" transition={0}
    accessible={false} pointerEvents="none" style={[{ width: size, height: size }, style]}/>;
});

/** Draw the plus geometrically: text glyph baselines vary between iOS/fonts. */
export const CoinAddIcon = memo(function CoinAddIcon({ size = 24 }: { size?: number }) {
  const length = size * .48, thickness = size * .08;
  return <View accessible={false} pointerEvents="none" style={{ width: size, height: size,
    borderRadius: size / 2, backgroundColor: '#D97335' }}>
    <View style={{ position: 'absolute', backgroundColor: '#FFFFFF', borderRadius: thickness / 2,
      width: length, height: thickness, left: (size - length) / 2, top: (size - thickness) / 2 }}/>
    <View style={{ position: 'absolute', backgroundColor: '#FFFFFF', borderRadius: thickness / 2,
      width: thickness, height: length, left: (size - thickness) / 2, top: (size - length) / 2 }}/>
  </View>;
});

/** Explicit currency markers avoid platform emoji and inline native image attachments. */
export function CoinLabel({ children, style, containerStyle, iconSize = 16, ...textProps }: Omit<TextProps, 'children'> & {
  children: string; iconSize?: number; containerStyle?: StyleProp<ViewStyle>;
}) {
  if (!children.includes('{coin}')) return <Text {...textProps} style={style}>{children}</Text>;
  return <View accessible accessibilityLabel={textProps.accessibilityLabel ?? children.replaceAll('{coin}', 'coins')}
    style={[styles.label, containerStyle]}>
    {children.split('{coin}').map((part, index) => <Fragment key={index}>
      {index > 0 && <CoinIcon size={iconSize}/>}
      {!!part.trim() && <Text {...textProps} accessible={false} style={style}>{part.trim()}</Text>}
    </Fragment>)}
  </View>;
}
const styles = StyleSheet.create({ label: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 1, flexWrap: 'wrap' } });
