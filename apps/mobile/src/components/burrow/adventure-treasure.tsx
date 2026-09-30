import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useIsFocused } from '@react-navigation/native';
import { haptics } from '@/lib/haptics';
import { BURROW_FIXED_ART } from '@/lib/burrow-art-assets';
export function AdventureTreasure({title,busy,onClaim}:{title:string;busy:boolean;onClaim:()=>void}) {
  const [opened,setOpened]=useState(false);const [reduce,setReduce]=useState(true);
  const scale=useRef(new Animated.Value(1)).current;
  const focused=useIsFocused();
  useEffect(()=>{let alive=true;void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(alive)setReduce(v);});
    const change=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduce);
    const state=AppState.addEventListener('change',v=>{if(v!=='active')scale.stopAnimation();});
    return()=>{alive=false;change.remove();state.remove();scale.stopAnimation();};},[scale]);
  useEffect(()=>{if(!focused)scale.stopAnimation();},[focused,scale]);
  return <View style={s.card}>
    <Text style={s.title}>{opened?'Treasure found!':'A treasure chest!'}</Text>
    <Animated.View accessible accessibilityLabel={opened?'Opened treasure chest':'Closed treasure chest'} style={{transform:[{scale}]}}><Image source={opened?BURROW_FIXED_ART.treasureOpen:BURROW_FIXED_ART.treasureClosed} contentFit="contain" style={s.chest}/></Animated.View>
    <Text style={s.copy}>{opened?title:'Your bunny brought a little discovery home.'}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} style={[s.button,busy&&{opacity:.5}]} onPress={()=>{
      if(opened){onClaim();return;}
      setOpened(true);void haptics.light();
      if(!reduce&&focused)Animated.sequence([Animated.timing(scale,{toValue:1.14,duration:160,useNativeDriver:true}),Animated.spring(scale,{toValue:1,useNativeDriver:true})]).start();
    }}><Text style={s.label}>{opened?'Claim item':'Tap to open'}</Text></Pressable>
    <Text style={s.copy}>Items are added only after the server confirms your claim.</Text>
  </View>;
}
const s=StyleSheet.create({card:{backgroundColor:'#FFF2DD',padding:24,borderRadius:26,gap:18},title:{fontSize:27,fontWeight:'800',color:'#5D3826',textAlign:'center'},chest:{width:'100%',height:200},copy:{fontSize:16,lineHeight:23,color:'#79563E',textAlign:'center'},button:{backgroundColor:'#2F8D72',padding:18,borderRadius:20},label:{fontSize:18,fontWeight:'700',color:'#FFF4E1',textAlign:'center'}});
