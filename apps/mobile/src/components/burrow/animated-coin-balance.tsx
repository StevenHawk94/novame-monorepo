import { memo,useState } from 'react';
import { StyleSheet, TextInput, type StyleProp, type TextInputProps, type TextStyle } from 'react-native';
import Animated, { useAnimatedProps,useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { formatAnimatedCoins } from '@/lib/burrow-motion';
import {coinNumberWidth} from '@/lib/coin-wallet-layout';

const NativeCounter = Animated.createAnimatedComponent(TextInput);
/** Update native text on the UI thread. Never setState/runOnJS for each digit. */
export const AnimatedCoinBalance = memo(function AnimatedCoinBalance({ value, target, from = target, fontSize = 20, width, style }: {
  value: SharedValue<number>; target: number; from?: number; fontSize?: number; width?: number; style?: StyleProp<TextStyle>;
}) {
  const props = useAnimatedProps(() => ({ text: formatAnimatedCoins(value.value) } as TextInputProps));
  // Keep React's native default text stable. Updating it on a receipt competes
  // with animatedProps and briefly paints a different balance mid-animation.
  const [initial]=useState(()=>formatAnimatedCoins(value.value));
  const sizing=useAnimatedStyle(()=>({width:width??coinNumberWidth(value.value,fontSize)}));
  return <NativeCounter animatedProps={props} defaultValue={initial} editable={false}
    accessible={false} pointerEvents="none" caretHidden contextMenuHidden underlineColorAndroid="transparent"
    allowFontScaling={false} style={[s.text, { fontSize },style,sizing]}/>;
});
const s = StyleSheet.create({ text: { padding: 0, margin: 0, color: '#21170F', textAlign: 'center',
  fontFamily: 'Inter_800ExtraBold', fontVariant: ['tabular-nums'], includeFontPadding: false } });
