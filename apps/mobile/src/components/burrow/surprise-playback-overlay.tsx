import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenOverlay } from '@/components/ui/screen-overlay';
import { SurpriseRain } from './surprise-rain';

export const SURPRISE_PLAYBACK_SCRIM = 'rgba(0,0,0,0.5)';
type Props = {frame:string;uri?:string;playing:boolean;onClose:()=>void;
  closeLabel?:string;showRain?:boolean;hideClose?:boolean;children?:ReactNode;portraitUri?:string;session?:number};

/** Exactly one black scrim; the real underlying page remains visible. */
export function SurprisePlaybackSurface({frame,uri,playing,onClose,closeLabel='Close surprise',showRain=true,hideClose=false,children,portraitUri,session}:Props){
  const insets=useSafeAreaInsets();
  return <View style={s.scrim} accessibilityViewIsModal>
    {showRain&&<SurpriseRain key={session} frame={frame} uri={uri} portraitUri={portraitUri} playing={playing} transparent/>}
    {children}
    {!hideClose&&<Pressable accessibilityRole="button" accessibilityLabel={closeLabel} hitSlop={8}
      onPress={onClose} style={[s.close,{top:insets.top+12}]}><Feather name="x" size={28} color="#FFF8EC"/></Pressable>}
  </View>;
}
export function SurprisePlaybackOverlay({visible,...props}:Props&{visible:boolean}){
  return <ScreenOverlay visible={visible} transparent statusBarTranslucent navigationBarTranslucent
    onRequestClose={props.onClose}><SurprisePlaybackSurface {...props}/></ScreenOverlay>;
}
const s=StyleSheet.create({scrim:{flex:1,backgroundColor:SURPRISE_PLAYBACK_SCRIM},
  close:{position:'absolute',right:20,padding:10,zIndex:2}});
