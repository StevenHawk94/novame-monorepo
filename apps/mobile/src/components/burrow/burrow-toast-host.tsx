import {useEffect,useSyncExternalStore} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {useAppViewport as useWindowDimensions} from '@/lib/app-viewport';
import {useSegments} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {burrowToast,clearBurrowToast} from '@/lib/burrow-toast';
import {homeTabBarHeight} from '@/lib/burrow-home-layout';
import {subscribeSessionIdentity} from '@/lib/session-lifecycle';

export function BurrowToastHost(){
 const notice=useSyncExternalStore(burrowToast.subscribe,burrowToast.read,burrowToast.read);
 const segments=useSegments(),insets=useSafeAreaInsets(),{width}=useWindowDimensions();
 const route=segments.join('/');
 useEffect(()=>{clearBurrowToast();return subscribeSessionIdentity(clearBurrowToast);},[route]);
 if(!notice)return null;
 return <View pointerEvents="none" style={[s.wrap,{bottom:(segments as readonly string[]).includes('(tabs)')?homeTabBarHeight(width,insets.bottom)+10:insets.bottom+20}]}>
  <View style={s.banner}><Text accessibilityRole="alert" style={s.text}>{notice.message}</Text></View>
 </View>;
}
const s=StyleSheet.create({wrap:{position:'absolute',left:18,right:18,zIndex:10000,alignItems:'center'},
 banner:{backgroundColor:'rgba(0,0,0,.72)',borderRadius:28,paddingHorizontal:22,paddingVertical:13,maxWidth:520},
 text:{fontSize:14,lineHeight:20,color:'#FFFFFF',textAlign:'center'}});
