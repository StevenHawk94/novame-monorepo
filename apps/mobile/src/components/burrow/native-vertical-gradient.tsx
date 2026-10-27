import {memo,useMemo} from 'react';
import {Platform,View,type StyleProp,type ViewStyle} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {nativeVerticalGradientStyle} from '@/lib/burrow-surface';

/** Same colors/geometry, less native redraw work. The app pins RN 0.81 with
 * Fabric enabled. Other platforms retain their original Expo implementation. */
export const NativeVerticalGradient=memo(function NativeVerticalGradient({colors,style}:{
  colors:readonly [string,string,...string[]];style:StyleProp<ViewStyle>;
}){
  const fill=useMemo(()=>nativeVerticalGradientStyle(colors),[colors]);
  const fabric=!!(globalThis as {nativeFabricUIManager?:unknown}).nativeFabricUIManager;
  if(Platform.OS==='ios'&&fabric)return <View pointerEvents="none" accessible={false} style={[style,fill]}/>;
  return <LinearGradient pointerEvents="none" colors={colors} style={style}/>;
});
